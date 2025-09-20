// pdf-converter.js
// Módulo para converter DOCX para PDF usando ConvertAPI

const axios = require('axios');
const FormData = require('form-data');

class PDFConverter {
  constructor() {
    this.apiSecret = process.env.CONVERT_API_SECRET;
    this.isConfigured = !!this.apiSecret && this.apiSecret !== 'SEU_SECRET_AQUI';
    
    if (this.isConfigured) {
      console.log('✅ ConvertAPI configurado para conversão PDF');
    } else {
      console.log('⚠️  ConvertAPI não configurado - conversão PDF desabilitada');
      console.log('    Configure CONVERT_API_SECRET no arquivo .env');
    }
  }

  async convertToPDF(docxBuffer, filename = 'document.docx') {
    if (!this.isConfigured) {
      console.log('📄 Conversão PDF solicitada mas ConvertAPI não configurado');
      return null;
    }

    try {
      console.log('🔄 Iniciando conversão DOCX → PDF...');
      
      // Criar FormData
      const form = new FormData();
      form.append('File', docxBuffer, {
        filename: filename,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      // Fazer requisição para ConvertAPI
      const response = await axios.post(
        `https://v2.convertapi.com/convert/docx/to/pdf?Secret=${this.apiSecret}`,
        form,
        {
          headers: {
            ...form.getHeaders()
          },
          maxBodyLength: Infinity,
          timeout: 30000 // 30 segundos
        }
      );

      // Verificar resposta
      if (response.data && response.data.Files && response.data.Files[0]) {
        const pdfBase64 = response.data.Files[0].FileData;
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        
        console.log('✅ PDF gerado com sucesso!');
        console.log(`   Tamanho: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
        console.log(`   Conversões restantes: ${response.data.ConversionCost?.UserBalance || 'N/A'}`);
        
        return pdfBuffer;
      }

      console.error('❌ Resposta inesperada da ConvertAPI');
      return null;

    } catch (error) {
      if (error.response) {
        console.error('❌ Erro ConvertAPI:', error.response.data?.Message || error.response.data);
        
        // Erros comuns
        if (error.response.status === 401) {
          console.error('   Secret inválido ou expirado');
        } else if (error.response.status === 402) {
          console.error('   Limite de conversões excedido');
        }
      } else {
        console.error('❌ Erro na conversão:', error.message);
      }
      
      return null;
    }
  }

  // Testar a configuração
  async testConnection() {
    if (!this.isConfigured) {
      return {
        success: false,
        message: 'ConvertAPI não configurado'
      };
    }

    try {
      // Criar um DOCX simples para teste
      const testDocx = Buffer.from('Test document');
      
      const form = new FormData();
      form.append('File', testDocx, 'test.txt');

      // Testar conversão de TXT para PDF (mais barato)
      const response = await axios.post(
        `https://v2.convertapi.com/convert/txt/to/pdf?Secret=${this.apiSecret}`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 10000
        }
      );

      if (response.data && response.data.Files) {
        return {
          success: true,
          message: 'ConvertAPI funcionando!',
          conversionsRemaining: response.data.ConversionCost?.UserBalance || 'N/A'
        };
      }

      return {
        success: false,
        message: 'Resposta inesperada'
      };

    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.Message || error.message
      };
    }
  }
}

// Exportar instância única
module.exports = new PDFConverter();