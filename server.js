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

// Chave API (use variável de ambiente em produção)
const API_KEY = process.env.API_KEY || 'YmFzZTQ0OnNlbmhhMTIzOjE3NTgzMDk2Mjc5MDk=';

// Middleware de autenticação
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API Key required' });
  }
  
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }
  
  next();
};

// Rotas públicas
app.get('/', (req, res) => {
  res.send('JusWay Documents API is running!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, service: 'JusWay Documents API' });
});

// Gerar documento REAL
app.post('/api/documents/generate', authenticate, async (req, res) => {
  const { templateUrl, data } = req.body;
  
  if (!templateUrl || !data) {
    return res.status(400).json({ error: 'templateUrl and data are required' });
  }

  try {
    console.log('Baixando template de:', templateUrl);
    
    // 1. Baixar o template .docx
    const response = await axios.get(templateUrl, { 
      responseType: 'arraybuffer' 
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

    // 4. Preencher com os dados
    doc.render(data);

    // 5. Gerar o documento final
    const buf = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });

    // 6. Retornar como Base64
    const base64String = Buffer.from(buf).toString('base64');
    
    res.json({ 
      success: true,
      base64: base64String, 
      filename: `documento_${Date.now()}.docx`,
      message: 'Documento gerado com sucesso!'
    });

  } catch (error) {
    console.error('Erro ao gerar documento:', error);
    
    // Tratamento de erros específicos
    let errorMessage = 'Falha ao gerar documento';
    let details = error.message;
    
    if (error.properties && error.properties.errors) {
      details = error.properties.errors.map(e => e.message).join(', ');
      errorMessage = 'Erro no template';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details 
    });
  }
});

// Listar templates (mock por enquanto)
app.get('/api/templates', authenticate, (req, res) => {
  res.json({ 
    success: true,
    templates: [
      { id: 'contrato', name: 'Contrato de Honorários' },
      { id: 'procuracao', name: 'Procuração' },
      { id: 'peticao', name: 'Petição Inicial' }
    ]
  });
});

// Escutar em todas as interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`JusWay Documents API rodando na porta ${PORT}`);
  console.log(`http://localhost:${PORT}/health`);
});
