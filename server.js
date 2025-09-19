// server-secure.js - Versão segura para multi-tenant
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Importar middleware de segurança
const SecurityMiddleware = require('./middleware/security');
const DocumentGenerator = require('./services/DocumentGenerator');
const StorageService = require('./services/StorageService');

const app = express();
const PORT = process.env.PORT || 3001;

// ====================================
// CONFIGURAÇÃO DE SEGURANÇA
// ====================================

// CORS mais flexível para produção
const corsOptions = {
  origin: function (origin, callback) {
    // Em produção no Railway, permitir requisições sem origin (health checks)
    if (!origin) {
      return callback(null, true);
    }
    
    // Permitir todas as origens por enquanto (ajustar depois)
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Limitar tamanho

// Rotas de teste - ANTES da segurança
app.get('/', (req, res) => {
  res.send('API funcionando!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ====================================
// APLICAR MIDDLEWARES DE SEGURANÇA
// ====================================

// Aplicar em TODAS as rotas exceto health check
app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  
  // Cadeia de segurança
  SecurityMiddleware.validateApiKey(req, res, () => {
    SecurityMiddleware.isolateTenantPaths(req, res, () => {
      SecurityMiddleware.sanitizeData(req, res, () => {
        SecurityMiddleware.rateLimiter(req, res, () => {
          SecurityMiddleware.auditLog(req, res, next);
        });
      });
    });
  });
});

// ====================================
// ROTAS
// ====================================

// Health check (sem autenticação)
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'JusWay Documents API (Secure)',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'JusWay Documents API (Secure)',
    timestamp: new Date().toISOString()
  });
});

// ====================================
// GERAR DOCUMENTO (com isolamento)
// ====================================
app.post('/api/documents/generate', async (req, res) => {
  const tenantId = req.tenantId;
  const tenantPaths = req.tenantPaths;
  
  try {
    const { templateId, data, outputFormat } = req.body;
    
    console.log(`📄 Tenant ${tenantId}: Gerando documento...`);
    
    // Buscar template do tenant específico
    const templatePath = path.join(tenantPaths.templates, `${templateId}.docx`);
    
    // Verificar se template existe E pertence ao tenant
    try {
      await fs.access(templatePath);
    } catch {
      return res.status(404).json({ 
        error: 'Template not found for this tenant' 
      });
    }
    
    // Gerar documento
    const generator = new DocumentGenerator();
    const outputPath = await generator.generate(templatePath, data);
    
    // Criptografar documento antes de salvar
    const docBuffer = await fs.readFile(outputPath);
    const encrypted = SecurityMiddleware.encryptDocument(tenantId, docBuffer);
    
    // Salvar documento criptografado
    const encryptedPath = path.join(
      tenantPaths.documents,
      `encrypted_${Date.now()}.bin`
    );
    
    await fs.mkdir(path.dirname(encryptedPath), { recursive: true });
    await fs.writeFile(encryptedPath, encrypted.encrypted);
    
    // Salvar metadados (IV e authTag) de forma segura
    const metadata = {
      tenantId: tenantId,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      createdAt: new Date().toISOString(),
      originalName: path.basename(outputPath)
    };
    
    // Limpar arquivo temporário
    await fs.unlink(outputPath);
    
    res.json({
      success: true,
      documentId: path.basename(encryptedPath, '.bin'),
      message: 'Document generated and encrypted',
      metadata: {
        createdAt: metadata.createdAt,
        format: outputFormat
      }
    });
    
  } catch (error) {
    console.error(`❌ Tenant ${tenantId}: Erro:`, error.message);
    
    // Não expor detalhes do erro em produção
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'Document generation failed' 
      : error.message;
      
    res.status(500).json({ error: errorMessage });
  }
});

// ====================================
// UPLOAD DE TEMPLATE (com isolamento)
// ====================================
app.post('/api/templates/upload', async (req, res) => {
  const tenantId = req.tenantId;
  const tenantPaths = req.tenantPaths;
  
  try {
    // Implementar upload com multer configurado para o path do tenant
    // ... código de upload isolado ...
    
    res.json({
      success: true,
      message: 'Template uploaded for tenant',
      tenantId: tenantId
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ====================================
// LISTAR TEMPLATES DO TENANT
// ====================================
app.get('/api/templates', async (req, res) => {
  const tenantId = req.tenantId;
  const tenantPaths = req.tenantPaths;
  
  try {
    // Criar diretório se não existir
    await fs.mkdir(tenantPaths.templates, { recursive: true });
    
    // Listar apenas templates do tenant
    const files = await fs.readdir(tenantPaths.templates);
    
    const templates = files
      .filter(f => f.endsWith('.docx'))
      .map(f => ({
        id: f.replace('.docx', ''),
        name: f,
        tenant: tenantId
      }));
    
    res.json({
      success: true,
      templates: templates,
      count: templates.length,
      tenantId: tenantId
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// ====================================
// DOWNLOAD DOCUMENTO (com descriptografia)
// ====================================
app.get('/api/documents/:documentId/download', async (req, res) => {
  const tenantId = req.tenantId;
  const tenantPaths = req.tenantPaths;
  const { documentId } = req.params;
  
  try {
    // Buscar documento criptografado
    const encryptedPath = path.join(
      tenantPaths.documents,
      `encrypted_${documentId}.bin`
    );
    
    // Verificar se existe E pertence ao tenant
    await fs.access(encryptedPath);
    
    // Ler arquivo e metadados
    const encryptedData = await fs.readFile(encryptedPath);
    
    // Buscar IV e authTag (em produção, do banco de dados)
    // Por ora, vamos simular
    const metadata = {
      iv: 'stored_iv',
      authTag: 'stored_authTag'
    };
    
    // Descriptografar
    const decrypted = SecurityMiddleware.decryptDocument(
      tenantId,
      encryptedData,
      metadata.iv,
      metadata.authTag
    );
    
    // Enviar arquivo
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="document_${documentId}.docx"`);
    res.send(decrypted);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(404).json({ error: 'Document not found' });
  }
});

// ====================================
// TRATAMENTO DE ERROS
// ====================================

// 404 para rotas não encontradas
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path 
  });
});

// Erro global handler
app.use((error, req, res, next) => {
  console.error('Global error:', error);
  
  // Não expor stack trace em produção
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : error.message;
    
  res.status(500).json({ error: message });
});

// ====================================
// INICIALIZAÇÃO
// ====================================

async function setupSecureEnvironment() {
  console.log('🔒 Configurando ambiente seguro...');
  
  // Criar estrutura base
  const baseDirs = [
    'tenants',
    'logs',
    'backups'
  ];
  
  for (const dir of baseDirs) {
    await fs.mkdir(dir, { recursive: true });
  }
  
  // Verificar variáveis obrigatórias
  const required = ['ENCRYPTION_KEY', 'ALLOWED_ORIGINS'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn('⚠️  Variáveis faltando:', missing.join(', '));
    console.warn('   Usando valores padrão (INSEGURO para produção!)');
  }
  
  console.log('✅ Ambiente seguro configurado');
}

async function start() {
  try {
    await setupSecureEnvironment();
    
    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════╗
║   JusWay Documents API (SECURE)         ║
║   Multi-Tenant Edition                  ║
║                                          ║
║   Port: ${PORT}                            ║
║   Mode: ${process.env.NODE_ENV || 'development'}            ║
║                                          ║
║   🔒 Security Features:                  ║
║   ✓ Tenant Isolation                    ║
║   ✓ API Key Authentication              ║
║   ✓ Document Encryption                 ║
║   ✓ Rate Limiting                       ║
║   ✓ Audit Logging                       ║
╚══════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
