// services/PDFConverter.js
const libre = require('libreoffice-convert');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const libreConvert = promisify(libre.convert);

class PDFConverter {
  constructor() {
    this.outputDir = 'output';
  }

  /**
   * Converte DOCX para PDF
   */
  async convert(docxPath) {
    try {
      console.log('📑 Convertendo para PDF:', docxPath);
      
      // Ler arquivo DOCX
      const docxBuffer = await fs.readFile(docxPath);
      
      // Definir caminho de saída
      const pdfFileName = path.basename(docxPath).replace('.docx', '.pdf');
      const pdfPath = path.join(this.outputDir, pdfFileName);
      
      // Converter usando LibreOffice
      const pdfBuffer = await this.convertWithLibreOffice(docxBuffer);
      
      // Salvar PDF
      await fs.writeFile(pdfPath, pdfBuffer);
      
      console.log('✅ PDF gerado:', pdfPath);
      return pdfPath;
      
    } catch (error) {
      console.error('Erro na conversão para PDF:', error);
      
      // Fallback: retornar null se conversão falhar
      // (o documento DOCX ainda estará disponível)
      return null;
    }
  }

  /**
   * Conversão usando LibreOffice
   */
  async convertWithLibreOffice(docxBuffer) {
    try {
      // LibreOffice precisa estar instalado no sistema
      const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);
      return pdfBuffer;
    } catch (error) {
      console.error('LibreOffice conversion failed:', error);
      throw new Error('PDF conversion failed. Please ensure LibreOffice is installed.');
    }
  }

  /**
   * Método alternativo: usar API externa (se LibreOffice não estiver disponível)
   */
  async convertWithExternalAPI(docxBuffer) {
    // Você pode implementar uma chamada para API externa aqui
    // Por exemplo: CloudConvert, ConvertAPI, etc.
    
    const CONVERT_API_URL = process.env.CONVERT_API_URL;
    const CONVERT_API_KEY = process.env.CONVERT_API_KEY;
    
    if (!CONVERT_API_URL || !CONVERT_API_KEY) {
      throw new Error('External PDF conversion API not configured');
    }
    
    // Exemplo de implementação:
    /*
    const formData = new FormData();
    formData.append('file', docxBuffer, 'document.docx');
    
    const response = await axios.post(CONVERT_API_URL, formData, {
      headers: {
        'Authorization': `Bearer ${CONVERT_API_KEY}`,
        ...formData.getHeaders()
      }
    });
    
    return Buffer.from(response.data, 'base64');
    */
    
    throw new Error('External API conversion not implemented');
  }
}

module.exports = PDFConverter;