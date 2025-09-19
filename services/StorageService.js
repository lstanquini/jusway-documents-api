// services/StorageService.js
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class StorageService {
  constructor() {
    // Você pode configurar diferentes providers aqui
    this.provider = process.env.STORAGE_PROVIDER || 'local'; // 'local', 'base44', 's3'
    this.uploadUrl = process.env.UPLOAD_URL || null;
    this.apiKey = process.env.STORAGE_API_KEY || null;
    this.localStoragePath = 'uploads';
  }

  /**
   * Faz upload de um arquivo
   */
  async uploadFile(filePath, destinationName) {
    switch (this.provider) {
      case 'base44':
        return await this.uploadToBase44(filePath, destinationName);
      case 's3':
        return await this.uploadToS3(filePath, destinationName);
      case 'local':
      default:
        return await this.uploadToLocal(filePath, destinationName);
    }
  }

  /**
   * Upload local (desenvolvimento)
   */
  async uploadToLocal(filePath, destinationName) {
    try {
      const fileName = path.basename(destinationName);
      const destPath = path.join(this.localStoragePath, fileName);
      
      // Criar diretório se não existir
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      
      // Copiar arquivo
      await fs.copyFile(filePath, destPath);
      
      // Retornar URL local (ajuste conforme necessário)
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      return `${baseUrl}/uploads/${fileName}`;
      
    } catch (error) {
      console.error('Erro no upload local:', error);
      throw error;
    }
  }

  /**
   * Upload para Base44 (usando a integração existente)
   */
  async uploadToBase44(filePath, destinationName) {
    try {
      if (!this.uploadUrl) {
        throw new Error('UPLOAD_URL not configured for Base44');
      }

      // Ler arquivo
      const fileBuffer = await fs.readFile(filePath);
      const fileName = path.basename(destinationName);
      
      // Criar FormData
      const formData = new FormData();
      formData.append('file', fileBuffer, fileName);
      
      // Fazer upload
      const response = await axios.post(this.uploadUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : undefined
        }
      });
      
      // Retornar URL do arquivo
      return response.data.url || response.data.fileUrl;
      
    } catch (error) {
      console.error('Erro no upload Base44:', error);
      throw new Error('Failed to upload to Base44');
    }
  }

  /**
   * Upload para S3 (exemplo)
   */
  async uploadToS3(filePath, destinationName) {
    // Implementar integração com S3 se necessário
    throw new Error('S3 upload not implemented yet');
  }

  /**
   * Baixa arquivo de uma URL
   */
  async downloadFile(url, destinationPath) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer'
      });
      
      await fs.writeFile(destinationPath, response.data);
      return destinationPath;
      
    } catch (error) {
      console.error('Erro no download:', error);
      throw new Error('Failed to download file');
    }
  }
}

module.exports = StorageService;