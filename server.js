// Carregar variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// Importar módulo R2 (se existir)
let r2Storage = null;
try {
  r2Storage = require('./r2-storage');
  console.log('📦 Módulo R2 carregado');
} catch (error) {
  console.log('⚠️  Módulo R2 não encontrado - usando apenas memória');
}

// Importar módulo PDF (se existir)
let pdfConverter = null;
try {
  pdfConverter = require('./pdf-converter');
  console.log('📄 Módulo PDF carregado');
} catch (error) {
  console.log('⚠️  Módulo PDF não encontrado');
}

const app = express();
const PORT = process.env.PORT || 8080;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configurar multer para upload
const upload = multer({ 
  memory: true,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Storage em memória para templates (temporário)
const templateStore = {};

// Chaves API por tenant (mover para banco de dados depois)
const API_KEYS = {
  'YmFzZTQ0OnNlbmhhMTIzOjE3NTgzMDk2Mjc5MDk=': 'base44',
  // Adicione outras chaves aqui
};

// Rate limiting simples
const requestCounts = {};

// ========================================
// MIDDLEWARES
// ========================================

// Middleware de autenticação melhorado
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API Key required' });
  }
  
  const tenantId = API_KEYS[apiKey];
  if (!tenantId) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }
  
  // Rate limiting simples (30 req/min)
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${tenantId}-${minute}`;
  
  requestCounts[key] = (requestCounts[key] || 0) + 1;
  
  if (requestCounts[key] > 30) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  // Adicionar tenant ao request
  req.tenantId = tenantId;
  next();
};

// ========================================
// FUNÇÕES AUXILIARES
// ========================================

// Validar URL segura
const isValidTemplateUrl = (url) => {
  try {
    const parsed = new URL(url);
    // Permitir apenas HTTPS
    if (parsed.protocol !== 'https:') return false;
    // Bloquear localhost e IPs internos
    if (parsed.hostname === 'localhost' || 
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.startsWith('192.168.') ||
        parsed.hostname.startsWith('10.')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

// Função para converter DOCX para PDF
async function convertToPDF(docxBuffer) {
  if (!pdfConverter) {
    console.log('📄 Conversor PDF não está disponível');
    return null;
  }
  
  return await pdfConverter.convertToPDF(docxBuffer);
}

// ========================================
// ROTAS PÚBLICAS
// ========================================

app.get('/', (req, res) => {
  res.send('JusWay Documents API is running!');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    port: PORT, 
    service: 'JusWay Documents API',
    modules: {
      r2: r2Storage ? 'loaded' : 'not loaded',
      pdf: pdfConverter ? 'loaded' : 'not loaded'
    }
  });
});

// Rota de teste do R2
app.get('/test-r2', async (req, res) => {
  if (!r2Storage) {
    return res.json({ success: false, message: 'R2 module not loaded' });
  }
  const result = await r2Storage.testConnection();
  res.json(result);
});

// Rota de teste do PDF
app.get('/test-pdf', async (req, res) => {
  if (!pdfConverter) {
    return res.json({ success: false, message: 'PDF converter not loaded' });
  }
  const result = await pdfConverter.testConnection();
  res.json(result);
});

// ========================================
// ROTAS DE TEMPLATES
// ========================================

// Listar templates
app.get('/api/templates', authenticate, async (req, res) => {
  const tenantId = req.tenantId;
  const templates = templateStore[tenantId] || {};
  
  // Combinar templates da memória
  const list = Object.values(templates).map(t => ({
    id: t.id,
    name: t.name,
    uploadedAt: t.uploadedAt,
    storage: 'memory'
  }));
  
  // Se R2 estiver configurado, podemos adicionar mais informações
  // Por enquanto, retornamos só o que está em memória
  
  res.json({ 
    success: true,
    tenant: tenantId,
    templates: list,
    count: list.length
  });
});

// Upload de template (ATUALIZADO com R2 e extração de variáveis)
app.post('/api/templates/upload', authenticate, upload.single('template'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const file = req.file;
    const { name } = req.body;
    
    if (!file) {
      return res.status(400).json({ error: 'Template file required' });
    }
    
    // Validar tipo de arquivo
    if (!file.mimetype.includes('wordprocessingml') && !file.mimetype.includes('msword')) {
      return res.status(400).json({ error: 'Only DOCX files are allowed' });
    }
    
    // Gerar ID único
    const templateId = `tmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Extrair variáveis do template
    let variables = {};
    let variableCount = 0;
    try {
      const zip = new PizZip(file.buffer);
      const doc = new Docxtemplater(zip, {
        delimiters: { start: '{{', end: '}}' },
        paragraphLoop: true,
        linebreaks: true
      });
      doc.compile();
      variables = doc.getTemplateVariables();
      variableCount = Object.keys(variables).length;
      console.log(`📝 Template ${templateId}: ${variableCount} variáveis detectadas`);
    } catch (err) {
      console.warn('⚠️  Não foi possível extrair variáveis:', err.message);
    }
    
    // Preparar metadados
    const metadata = {
      id: templateId,
      name: name || file.originalname,
      originalName: file.originalname,
      size: file.buffer.length,
      uploadedAt: new Date().toISOString(),
      variables: variables,
      variableCount: variableCount
    };
    
    // Salvar na memória (sempre)
    if (!templateStore[tenantId]) {
      templateStore[tenantId] = {};
    }
    
    templateStore[tenantId][templateId] = {
      ...metadata,
      buffer: file.buffer
    };
    
    console.log(`💾 Template ${templateId} salvo na memória`);
    
    // Tentar salvar no R2 também
    let storageLocation = 'local';
    if (r2Storage && r2Storage.isConfigured) {
      const r2Result = await r2Storage.saveTemplate(tenantId, templateId, file.buffer, metadata);
      if (r2Result.success) {
        console.log(`☁️  Template ${templateId} também salvo no R2!`);
        storageLocation = 'cloud';
      }
    }
    
    // Resposta para o Base44
    res.json({
      success: true,
      templateId: templateId,
      message: 'Template uploaded successfully',
      storage: storageLocation,
      variables: variables,
      metadata: {
        name: metadata.name,
        size: metadata.size,
        variableCount: variableCount
      }
    });
    
  } catch (error) {
    console.error('❌ Erro no upload:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// Extrair variáveis de um template enviado
app.post('/api/templates/extract-variables', authenticate, upload.single('template'), async (req, res) => {
  try {
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'Template file required' });
    }
    
    const zip = new PizZip(file.buffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true
    });
    
    doc.compile();
    const variables = doc.getTemplateVariables();
    
    res.json({
      success: true,
      variables: variables,
      count: Object.keys(variables).length
    });
    
  } catch (error) {
    console.error('❌ Erro ao extrair variáveis:', error);
    res.status(500).json({ error: 'Failed to extract variables' });
  }
});

// Verificar variáveis de template armazenado
app.get('/api/templates/:templateId/variables', authenticate, async (req, res) => {
  const tenantId = req.tenantId;
  const { templateId } = req.params;
  
  try {
    // Tentar buscar da memória primeiro
    let template = templateStore[tenantId]?.[templateId];
    
    // Se não encontrar na memória e R2 estiver configurado, buscar do R2
    if (!template && r2Storage && r2Storage.isConfigured) {
      console.log(`🔍 Buscando template ${templateId} do R2...`);
      const r2Data = await r2Storage.getTemplate(tenantId, templateId);
      if (r2Data) {
        template = {
          buffer: r2Data.buffer,
          name: r2Data.metadata?.templateName || 'Template',
          ...r2Data.metadata
        };
        // Cachear na memória
        if (!templateStore[tenantId]) {
          templateStore[tenantId] = {};
        }
        templateStore[tenantId][templateId] = template;
      }
    }
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Se já tem as variáveis nos metadados, retornar direto
    if (template.variables) {
      return res.json({
        success: true,
        templateId: templateId,
        templateName: template.name,
        variables: template.variables,
        count: template.variableCount || Object.keys(template.variables).length
      });
    }
    
    // Senão, extrair do buffer
    const zip = new PizZip(template.buffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' }
    });
    
    doc.compile();
    const variables = doc.getTemplateVariables();
    
    res.json({
      success: true,
      templateId: templateId,
      templateName: template.name,
      variables: variables,
      count: Object.keys(variables).length
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar variáveis:', error);
    res.status(500).json({ error: 'Failed to get template variables' });
  }
});

// Deletar template (soft delete)
app.delete('/api/templates/:templateId', authenticate, async (req, res) => {
  const tenantId = req.tenantId;
  const { templateId } = req.params;
  
  try {
    // Remover da memória
    if (templateStore[tenantId]?.[templateId]) {
      delete templateStore[tenantId][templateId];
      console.log(`🗑️  Template ${templateId} removido da memória`);
    }
    
    // TODO: Implementar soft delete no R2
    // if (r2Storage) {
    //   await r2Storage.deleteTemplate(tenantId, templateId);
    // }
    
    res.json({
      success: true,
      message: 'Template deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Erro ao deletar template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ========================================
// ROTAS DE GERAÇÃO DE DOCUMENTOS
// ========================================

// Gerar documento principal (com suporte a PDF)
app.post('/api/documents/generate', authenticate, async (req, res) => {
  const { templateUrl, templateId, data, outputFormat = 'docx' } = req.body;
  const tenantId = req.tenantId;
  
  // Aceitar templateId OU templateUrl para compatibilidade
  const hasTemplateId = templateId && !templateUrl;
  const hasTemplateUrl = templateUrl && !templateId;
  
  if (!data || (!hasTemplateId && !hasTemplateUrl)) {
    return res.status(400).json({ error: 'Data and (templateId or templateUrl) are required' });
  }

  try {
    let docxBuffer;
    let templateName = 'document';
    
    if (hasTemplateId) {
      // Buscar template do armazenamento
      console.log(`📄 Tenant ${tenantId}: Gerando documento com template ${templateId}`);
      
      // Tentar memória primeiro
      let template = templateStore[tenantId]?.[templateId];
      
      // Se não encontrar na memória e R2 estiver configurado, buscar do R2
      if (!template && r2Storage && r2Storage.isConfigured) {
        console.log(`🔍 Template não está em memória, buscando do R2...`);
        const r2Data = await r2Storage.getTemplate(tenantId, templateId);
        if (r2Data) {
          template = {
            buffer: r2Data.buffer,
            name: r2Data.metadata?.templateName || 'Template',
            ...r2Data.metadata
          };
          // Cachear na memória
          if (!templateStore[tenantId]) {
            templateStore[tenantId] = {};
          }
          templateStore[tenantId][templateId] = template;
        }
      }
      
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      
      templateName = template.name || 'document';
      
      // Processar com o template encontrado
      const zip = new PizZip(template.buffer);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' }
      });
      
      doc.render(data);
      docxBuffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE'
      });
      
    } else if (hasTemplateUrl) {
      // Baixar template da URL (compatibilidade antiga)
      console.log(`📥 Tenant ${tenantId}: Baixando template de URL`);
      
      if (!isValidTemplateUrl(templateUrl)) {
        return res.status(400).json({ error: 'Invalid template URL' });
      }
      
      const response = await axios.get(templateUrl, { 
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 10 * 1024 * 1024
      });
      
      const zip = new PizZip(response.data);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' }
      });

      const sanitizedData = JSON.parse(JSON.stringify(data));
      doc.render(sanitizedData);
      
      docxBuffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE'
      });
    }

    console.log(`✅ Documento DOCX gerado com sucesso (${(docxBuffer.length / 1024).toFixed(2)} KB)`);

    // Se solicitado PDF, tentar converter
    let pdfBuffer = null;
    let pdfBase64 = null;
    
    if (outputFormat === 'pdf' || outputFormat === 'both') {
      console.log('🔄 Conversão para PDF solicitada...');
      pdfBuffer = await convertToPDF(docxBuffer);
      
      if (pdfBuffer) {
        pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
        console.log(`✅ PDF gerado com sucesso (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);
      } else {
        console.log('⚠️  Conversão para PDF não disponível');
      }
    }
    
    // Preparar resposta baseada no formato solicitado
    const timestamp = Date.now();
    const baseFilename = `documento_${timestamp}`;
    
    // Para compatibilidade com Base44, manter formato simples quando for só DOCX
    if (outputFormat === 'docx' && !pdfBase64) {
      res.json({
        success: true,
        base64: Buffer.from(docxBuffer).toString('base64'),
        filename: `${baseFilename}.docx`,
        message: 'Documento gerado com sucesso!',
        tenant: tenantId
      });
    } else {
      // Resposta com formatos múltiplos
      const responseData = {
        success: true,
        filename: baseFilename,
        message: 'Documento gerado com sucesso!',
        tenant: tenantId,
        formats: {}
      };
      
      // Adicionar DOCX se solicitado ou como fallback
      if (outputFormat === 'docx' || outputFormat === 'both' || !pdfBase64) {
        responseData.formats.docx = {
          base64: Buffer.from(docxBuffer).toString('base64'),
          filename: `${baseFilename}.docx`,
          size: docxBuffer.length
        };
      }
      
      // Adicionar PDF se disponível
      if (pdfBase64 && (outputFormat === 'pdf' || outputFormat === 'both')) {
        responseData.formats.pdf = {
          base64: pdfBase64,
          filename: `${baseFilename}.pdf`,
          size: pdfBuffer.length
        };
      }
      
      // Aviso se PDF foi solicitado mas não está disponível
      if (outputFormat === 'pdf' && !pdfBase64) {
        responseData.warning = 'PDF conversion not available, returning DOCX format';
      }
      
      res.json(responseData);
    }

  } catch (error) {
    console.error(`❌ Tenant ${tenantId}: Erro ao gerar documento:`, error.message);
    
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'Falha ao gerar documento' 
      : error.message;
    
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

// ========================================
// LIMPEZA PERIÓDICA
// ========================================

// Limpar rate limit a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  
  for (const key in requestCounts) {
    const minute = parseInt(key.split('-')[1]);
    if (currentMinute - minute > 5) {
      delete requestCounts[key];
    }
  }
}, 300000);

// Limpar cache de templates em memória a cada hora (opcional)
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  let cleaned = 0;
  
  for (const tenantId in templateStore) {
    for (const templateId in templateStore[tenantId]) {
      const template = templateStore[tenantId][templateId];
      // Limpar templates não usados há mais de 1 hora
      if (template.lastUsed && (now - template.lastUsed) > ONE_HOUR) {
        delete templateStore[tenantId][templateId];
        cleaned++;
      }
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cache cleanup: ${cleaned} templates removidos da memória`);
  }
}, 3600000); // 1 hora

// ========================================
// INICIALIZAÇÃO DO SERVIDOR
// ========================================

// Escutar em todas as interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`🚀 JusWay Documents API`);
  console.log(`📍 Porta: ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('========================================');
  console.log('📦 Módulos carregados:');
  
  if (r2Storage && r2Storage.isConfigured) {
    console.log('   ✅ R2 Storage: Configurado');
  } else {
    console.log('   ⚠️  R2 Storage: Não configurado');
  }
  
  if (pdfConverter && pdfConverter.isConfigured) {
    console.log('   ✅ PDF Converter: Configurado');
  } else {
    console.log('   ⚠️  PDF Converter: Não configurado');
  }
  
  console.log('========================================');
  console.log('📚 Endpoints disponíveis:');
  console.log('   GET  /health');
  console.log('   GET  /test-r2');
  console.log('   GET  /test-pdf');
  console.log('   GET  /api/templates');
  console.log('   POST /api/templates/upload');
  console.log('   GET  /api/templates/:id/variables');
  console.log('   POST /api/documents/generate');
  console.log('========================================');
});