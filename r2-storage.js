// r2-storage.js
// Módulo para gerenciar arquivos no Cloudflare R2

require('dotenv').config(); // Carregar as variáveis do .env

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

class R2Storage {
  constructor() {
    this.isConfigured = false;
    this.client = null;
    this.bucketName = process.env.R2_BUCKET_NAME || 'jusway-templates';
    
    // Tentar configurar o R2
    this.initialize();
  }

  initialize() {
    // Verificar se temos as credenciais
    if (!process.env.R2_ACCOUNT_ID || 
        !process.env.R2_ACCESS_KEY_ID || 
        !process.env.R2_SECRET_ACCESS_KEY) {
      console.log('⚠️  R2 não está configurado - verifique o arquivo .env');
      console.log('    Usando armazenamento em memória por enquanto');
      return;
    }

    try {
      // Criar o cliente do R2
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
        },
        forcePathStyle: true
      });

      this.isConfigured = true;
      console.log('✅ R2 Storage configurado com sucesso!');
      
    } catch (error) {
      console.error('❌ Erro ao configurar R2:', error.message);
    }
  }

  // Função para salvar template no R2
  async saveTemplate(tenantId, templateId, buffer, metadata) {
    if (!this.isConfigured) {
      console.log('📦 R2 não configurado - template não será salvo na nuvem');
      return { success: false, reason: 'R2_NOT_CONFIGURED' };
    }

    try {
      // Nome do arquivo no R2
      const fileName = `tenants/${tenantId}/templates/${templateId}.docx`;
      
      console.log(`📤 Enviando template ${templateId} para o R2...`);
      
      // Enviar arquivo para o R2
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: buffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        Metadata: {
          tenantId: tenantId,
          templateName: metadata.name || 'template.docx',
          uploadedAt: new Date().toISOString()
        }
      }));

      console.log(`✅ Template ${templateId} salvo no R2 com sucesso!`);
      
      return { 
        success: true, 
        location: 'r2',
        fileName: fileName 
      };

    } catch (error) {
      console.error('❌ Erro ao salvar no R2:', error.message);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  // Função para buscar template do R2
  async getTemplate(tenantId, templateId) {
    if (!this.isConfigured) {
      console.log('📦 R2 não configurado');
      return null;
    }

    try {
      const fileName = `tenants/${tenantId}/templates/${templateId}.docx`;
      
      console.log(`📥 Buscando template ${templateId} do R2...`);
      
      // Buscar arquivo do R2
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fileName
      }));

      // Converter para Buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      
      console.log(`✅ Template ${templateId} baixado do R2!`);
      
      return {
        buffer: buffer,
        metadata: response.Metadata
      };

    } catch (error) {
      if (error.Code === 'NoSuchKey') {
        console.log(`⚠️  Template ${templateId} não encontrado no R2`);
        return null;
      }
      console.error('❌ Erro ao buscar do R2:', error.message);
      return null;
    }
  }

  // Testar conexão com R2
  async testConnection() {
    if (!this.isConfigured) {
      return { success: false, message: 'R2 não configurado' };
    }

    try {
      console.log('🔍 Testando conexão com R2...');
      
      // Tentar listar o bucket (só para testar)
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: 'test/connection-test.txt',
        Body: 'Teste de conexão ' + new Date().toISOString()
      });
      
      await this.client.send(command);
      
      console.log('✅ Conexão com R2 funcionando!');
      return { success: true, message: 'Conexão OK' };
      
    } catch (error) {
      console.error('❌ Erro ao conectar com R2:', error.message);
      return { success: false, message: error.message };
    }
  }
}

// Exportar uma instância única
module.exports = new R2Storage();