// test-generation.js - Teste do microserviço
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const API_URL = 'http://localhost:3001';

async function testDocumentGeneration() {
  console.log('🧪 Testando geração de documentos...\n');

  try {
    // 1. Teste de health check
    console.log('1️⃣ Testando health check...');
    const health = await axios.get(`${API_URL}/health`);
    console.log('✅ Servidor está rodando:', health.data);
    console.log('');

    // 2. Upload de template de teste
    console.log('2️⃣ Fazendo upload de template...');
    
    // Criar um template de teste se não existir
    if (!fs.existsSync('test-template.docx')) {
      console.log('⚠️ Crie um arquivo test-template.docx com variáveis {{nome}}, {{cpf}}, {{valor}}');
      return;
    }

    const formData = new FormData();
    formData.append('template', fs.createReadStream('test-template.docx'));
    formData.append('name', 'Contrato de Teste');
    formData.append('type', 'contrato');

    const uploadResponse = await axios.post(
      `${API_URL}/api/templates/upload`,
      formData,
      {
        headers: formData.getHeaders()
      }
    );

    console.log('✅ Template uploaded:', uploadResponse.data.template);
    const templateId = uploadResponse.data.template.id;
    console.log('');

    // 3. Gerar documento
    console.log('3️⃣ Gerando documento...');
    
    const generateResponse = await axios.post(
      `${API_URL}/api/documents/generate`,
      {
        templateId: templateId,
        data: {
          nome: 'João da Silva',
          cpf: '12345678900',
          valor: 5000,
          data_contrato: new Date().toISOString(),
          endereco: 'Rua das Flores, 123',
          cidade: 'São Paulo',
          estado: 'SP',
          
          // Arrays para loops
          servicos: [
            { descricao: 'Consultoria Jurídica', valor: 2000 },
            { descricao: 'Elaboração de Contratos', valor: 1500 },
            { descricao: 'Acompanhamento Processual', valor: 1500 }
          ],
          
          // Condicionais
          incluir_multa: true,
          incluir_garantia: false
        },
        outputFormat: 'both', // Gera DOCX e PDF
        fileName: 'contrato_teste'
      }
    );

    console.log('✅ Documento gerado com sucesso!');
    console.log('📄 Resultado:', JSON.stringify(generateResponse.data, null, 2));
    console.log('');

    // 4. Listar templates
    console.log('4️⃣ Listando templates disponíveis...');
    const templatesResponse = await axios.get(`${API_URL}/api/templates`);
    console.log('📋 Templates:', templatesResponse.data);
    console.log('');

    console.log('🎉 Todos os testes passaram!');

  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
    if (error.response) {
      console.error('Detalhes:', error.response.data);
    }
  }
}

// Executar testes
testDocumentGeneration();