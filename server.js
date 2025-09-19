// server.js - Microserviço JusWay Documents API
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();

// Importar serviços
const DocumentGenerator = require('./services/DocumentGenerator');
const StorageService = require('./services/StorageService');
const PDFConverter = require('./services/PDFConverter');

// Configuração Express
const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // URL do Base44
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuração Multer para upload temporário
const upload = multer({
  dest: 'temp/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Inicializar serviços
const documentGenerator = new DocumentGenerator();
const storageService = new StorageService();
const pdfConverter = new PDFConverter();

// Criar diretórios necessários
async function setupDirectories() {
  const dirs = ['temp', 'templates', 'output', 'uploads'];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// ====================================
// ROTAS PRINCIPAIS
// ====================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'JusWay Documents API',
    timestamp: new Date().toISOString()
  });
});

// ====================================
// 1. UPLOAD DE TEMPLATE
// ====================================
app.post('/api/templates/upload', upload.single('template'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Template file is required' });
    }

    // Validar que é um arquivo DOCX
    if (!file.originalname.endsWith('.docx')) {
      await fs.unlink(file.path); // Limpar arquivo temporário
      return res.status(400).json({ error: 'Only .docx files are allowed' });
    }

    // Mover para pasta de templates
    const templateId = uuidv4();
    const templatePath = path.join('templates', `${templateId}.docx`);
    await fs.rename(file.path, templatePath);

    // Extrair variáveis do template
    const variables = await documentGenerator.extractVariables(templatePath);

    // Salvar metadados (em produção, salvar no banco)
    const templateData = {
      id: templateId,
      name: name || file.originalname,
      type: type || 'general',
      description: description || '',
      path: templatePath,
      variables: variables,
      uploadedAt: new Date().toISOString()
    };

    // Fazer upload para storage permanente (opcional)
    const uploadedUrl = await storageService.uploadFile(templatePath, `templates/${templateId}.docx`);
    templateData.url = uploadedUrl;

    res.json({
      success: true,
      template: templateData,
      message: 'Template uploaded successfully'
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 2. GERAR DOCUMENTO A PARTIR DE TEMPLATE
// ====================================
app.post('/api/documents/generate', async (req, res) => {
  try {
    const {
      templateUrl,      // URL do template .docx no storage
      templateId,       // OU ID do template local
      data,            // Dados para preencher
      outputFormat,    // 'docx', 'pdf', ou 'both'
      fileName        // Nome do arquivo de saída
    } = req.body;

    console.log('📄 Iniciando geração de documento...');
    console.log('Template:', templateUrl || templateId);
    console.log('Formato:', outputFormat || 'docx');

    // 1. Obter o template
    let templatePath;
    
    if (templateUrl) {
      // Baixar template da URL
      console.log('📥 Baixando template da URL...');
      templatePath = await downloadTemplate(templateUrl);
    } else if (templateId) {
      // Usar template local
      templatePath = path.join('templates', `${templateId}.docx`);
    } else {
      return res.status(400).json({ 
        error: 'templateUrl or templateId is required' 
      });
    }

    // Verificar se template existe
    try {
      await fs.access(templatePath);
    } catch {
      return res.status(404).json({ 
        error: 'Template not found' 
      });
    }

    // 2. Gerar documento DOCX
    console.log('🔄 Processando template com dados...');
    const outputPath = await documentGenerator.generate(templatePath, data);
    
    // 3. Gerar nome do arquivo
    const baseFileName = fileName || `documento_${Date.now()}`;
    const docxFileName = `${baseFileName}.docx`;
    
    // 4. Fazer upload do DOCX
    console.log('☁️ Fazendo upload do DOCX...');
    const docxUrl = await storageService.uploadFile(
      outputPath,
      `documents/${docxFileName}`
    );

    const response = {
      success: true,
      documentId: uuidv4(),
      fileName: baseFileName,
      formats: {}
    };

    // 5. Se solicitado, gerar PDF
    if (outputFormat === 'pdf' || outputFormat === 'both') {
      console.log('📑 Convertendo para PDF...');
      try {
        const pdfPath = await pdfConverter.convert(outputPath);
        const pdfFileName = `${baseFileName}.pdf`;
        
        console.log('☁️ Fazendo upload do PDF...');
        const pdfUrl = await storageService.uploadFile(
          pdfPath,
          `documents/${pdfFileName}`
        );
        
        response.formats.pdf = {
          url: pdfUrl,
          fileName: pdfFileName
        };
        
        // Limpar arquivo PDF temporário
        await fs.unlink(pdfPath).catch(() => {});
      } catch (pdfError) {
        console.error('Erro na conversão PDF:', pdfError);
        response.warning = 'PDF conversion failed, but DOCX was generated successfully';
      }
    }

    // Sempre incluir DOCX
    if (outputFormat !== 'pdf') {
      response.formats.docx = {
        url: docxUrl,
        fileName: docxFileName
      };
    }

    // 6. Limpar arquivos temporários
    await fs.unlink(outputPath).catch(() => {});
    if (templateUrl) {
      await fs.unlink(templatePath).catch(() => {});
    }

    console.log('✅ Documento gerado com sucesso!');
    res.json(response);

  } catch (error) {
    console.error('❌ Erro na geração:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
});

// ====================================
// 3. GERAR A PARTIR DE URL E DADOS
// ====================================
app.post('/api/documents/generate-from-url', async (req, res) => {
  try {
    const { templateUrl, data, outputFormat = 'docx' } = req.body;

    if (!templateUrl) {
      return res.status(400).json({ error: 'templateUrl is required' });
    }

    // Reutilizar a rota principal
    req.body.outputFormat = outputFormat;
    return app._router.handle(req, res);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 4. EXTRAIR VARIÁVEIS DE UM TEMPLATE
// ====================================
app.post('/api/templates/extract-variables', upload.single('template'), async (req, res) => {
  try {
    let templatePath;

    if (req.file) {
      // Upload direto
      templatePath = req.file.path;
    } else if (req.body.templateUrl) {
      // Download da URL
      templatePath = await downloadTemplate(req.body.templateUrl);
    } else {
      return res.status(400).json({ 
        error: 'Template file or templateUrl is required' 
      });
    }

    // Extrair variáveis
    const variables = await documentGenerator.extractVariables(templatePath);

    // Limpar arquivo temporário
    await fs.unlink(templatePath).catch(() => {});

    res.json({
      success: true,
      variables: variables,
      count: Object.keys(variables).length
    });

  } catch (error) {
    console.error('Extract variables error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 5. LISTAR TEMPLATES DISPONÍVEIS
// ====================================
app.get('/api/templates', async (req, res) => {
  try {
    const templatesDir = 'templates';
    const files = await fs.readdir(templatesDir);
    
    const templates = [];
    for (const file of files) {
      if (file.endsWith('.docx')) {
        const filePath = path.join(templatesDir, file);
        const stats = await fs.stat(filePath);
        
        // Extrair variáveis
        const variables = await documentGenerator.extractVariables(filePath);
        
        templates.push({
          id: file.replace('.docx', ''),
          fileName: file,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          variables: Object.keys(variables)
        });
      }
    }

    res.json({
      success: true,
      templates: templates,
      count: templates.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// FUNÇÕES AUXILIARES
// ====================================

async function downloadTemplate(url) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer'
    });

    const tempPath = path.join('temp', `template_${uuidv4()}.docx`);
    await fs.writeFile(tempPath, response.data);
    
    return tempPath;
  } catch (error) {
    console.error('Error downloading template:', error);
    throw new Error('Failed to download template from URL');
  }
}

// ====================================
// TRATAMENTO DE ERROS
// ====================================

app.use((error, req, res, next) => {
  console.error('Global error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// ====================================
// INICIALIZAÇÃO
// ====================================

async function start() {
  try {
    await setupDirectories();
    
    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════╗
║   JusWay Documents API              ║
║   Servidor rodando na porta ${PORT}    ║
║                                      ║
║   Endpoints disponíveis:             ║
║   - POST /api/documents/generate     ║
║   - POST /api/templates/upload       ║
║   - GET  /api/templates              ║
║   - GET  /health                     ║
╚══════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();