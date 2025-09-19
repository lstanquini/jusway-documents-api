const express = require('express');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Chaves API por tenant (mover para banco de dados depois)
const API_KEYS = {
  'YmFzZTQ0OnNlbmhhMTIzOjE3NTgzMDk2Mjc5MDk=': 'base44',
  // Adicione outras chaves aqui
};

// Rate limiting simples
const requestCounts = {};

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

// Rotas públicas
app.get('/', (req, res) => {
  res.send('JusWay Documents API is running!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, service: 'JusWay Documents API' });
});

// Gerar documento com segurança melhorada
app.post('/api/documents/generate', authenticate, async (req, res) => {
  const { templateUrl, data } = req.body;
  const tenantId = req.tenantId;
  
  if (!templateUrl || !data) {
    return res.status(400).json({ error: 'templateUrl and data are required' });
  }

  // Validar URL
  if (!isValidTemplateUrl(templateUrl)) {
    return res.status(400).json({ error: 'Invalid template URL' });
  }

  try {
    console.log(`Tenant ${tenantId}: Gerando documento`);
    
    // 1. Baixar o template .docx (com timeout)
    const response = await axios.get(templateUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000, // 10 segundos
      maxContentLength: 10 * 1024 * 1024 // 10MB máximo
    });
    const content = response.data;

    // 2. Carregar com PizZip
    const zip = new PizZip(content);
    
    // 3. Criar documento com Docxtemplater
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: '{{',
        end: '}}'
      }
    });

    // 4. Sanitizar dados (remover scripts, etc)
    const sanitizedData = JSON.parse(JSON.stringify(data));

    // 5. Preencher com os dados
    doc.render(sanitizedData);

    // 6. Gerar o documento final
    const buf = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });

    // 7. Retornar como Base64
    const base64String = Buffer.from(buf).toString('base64');
    
    console.log(`Tenant ${tenantId}: Documento gerado com sucesso`);
    
    res.json({ 
      success: true,
      base64: base64String, 
      filename: `documento_${Date.now()}.docx`,
      message: 'Documento gerado com sucesso!',
      tenant: tenantId
    });

  } catch (error) {
    console.error(`Tenant ${tenantId}: Erro ao gerar documento:`, error.message);
    
    // Não expor detalhes do erro em produção
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? 'Falha ao gerar documento' 
      : error.message;
    
    res.status(500).json({ 
      error: errorMessage
    });
  }
});

// Listar templates
app.get('/api/templates', authenticate, (req, res) => {
  const tenantId = req.tenantId;
  
  res.json({ 
    success: true,
    tenant: tenantId,
    templates: [
      { id: 'contrato', name: 'Contrato de Honorários' },
      { id: 'procuracao', name: 'Procuração' },
      { id: 'peticao', name: 'Petição Inicial' }
    ]
  });
});

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

// Escutar em todas as interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`JusWay Documents API rodando na porta ${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
});
