// services/DocumentGenerator.js
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DocumentGenerator {
  constructor() {
    this.outputDir = 'output';
  }

  /**
   * Gera documento a partir de template e dados
   */
  async generate(templatePath, data) {
    try {
      console.log('📋 Carregando template:', templatePath);
      
      // Ler o arquivo template
      const content = await fs.readFile(templatePath, 'binary');
      
      // Criar zip do documento
      const zip = new PizZip(content);
      
      // Configurar o Docxtemplater
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: {
          start: '{{',
          end: '}}'
        }
      });

      // Processar dados antes de preencher
      const processedData = this.processData(data);
      
      console.log('📝 Preenchendo variáveis:', Object.keys(processedData));
      
      // Preencher o template com os dados
      doc.setData(processedData);
      
      // Renderizar o documento
      try {
        doc.render();
      } catch (error) {
        console.error('Erro no render:', error);
        throw new Error(`Erro ao processar template: ${this.getErrorMessage(error)}`);
      }
      
      // Gerar o buffer do documento
      const buf = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9
        }
      });
      
      // Salvar o documento gerado
      const outputFileName = `document_${uuidv4()}.docx`;
      const outputPath = path.join(this.outputDir, outputFileName);
      
      await fs.writeFile(outputPath, buf);
      
      console.log('✅ Documento gerado:', outputPath);
      return outputPath;
      
    } catch (error) {
      console.error('Erro na geração:', error);
      throw error;
    }
  }

  /**
   * Extrai variáveis de um template
   */
  async extractVariables(templatePath) {
    try {
      const content = await fs.readFile(templatePath, 'binary');
      const zip = new PizZip(content);
      
      const doc = new Docxtemplater(zip, {
        delimiters: {
          start: '{{',
          end: '}}'
        }
      });
      
      // Parse do template sem renderizar
      doc.compile();
      
      // Obter todas as variáveis
      const variables = doc.getTemplateVariables();
      
      console.log('📋 Variáveis encontradas:', variables);
      return variables;
      
    } catch (error) {
      console.error('Erro ao extrair variáveis:', error);
      throw new Error('Failed to extract variables from template');
    }
  }

  /**
   * Processa e formata dados antes de preencher
   */
  processData(data) {
    const processed = { ...data };
    
    // Adicionar funções de formatação úteis
    processed.hoje = this.formatDate(new Date());
    processed.agora = this.formatDateTime(new Date());
    
    // Processar arrays para loops
    for (const key in processed) {
      if (Array.isArray(processed[key])) {
        // Garantir que arrays tenham a estrutura correta
        processed[key] = processed[key].map(item => {
          if (typeof item === 'string') {
            return { value: item };
          }
          return item;
        });
      }
      
      // Formatar valores monetários
      if (key.includes('valor') || key.includes('preco')) {
        if (typeof processed[key] === 'number') {
          processed[`${key}_formatado`] = this.formatCurrency(processed[key]);
        }
      }
      
      // Formatar CPF/CNPJ
      if (key.includes('cpf')) {
        processed[`${key}_formatado`] = this.formatCPF(processed[key]);
      }
      if (key.includes('cnpj')) {
        processed[`${key}_formatado`] = this.formatCNPJ(processed[key]);
      }
      
      // Formatar datas
      if (key.includes('data') && processed[key]) {
        if (typeof processed[key] === 'string') {
          const date = new Date(processed[key]);
          if (!isNaN(date)) {
            processed[`${key}_formatada`] = this.formatDate(date);
            processed[`${key}_extenso`] = this.dateToExtensive(date);
          }
        }
      }
    }
    
    // Adicionar campos condicionais úteis
    processed.tem = {};
    for (const key in data) {
      processed.tem[key] = !!data[key];
    }
    
    return processed;
  }

  /**
   * Formata data para DD/MM/AAAA
   */
  formatDate(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Formata data e hora
   */
  formatDateTime(date) {
    const d = new Date(date);
    const dateStr = this.formatDate(d);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${dateStr} às ${hours}:${minutes}`;
  }

  /**
   * Formata valor monetário
   */
  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  }

  /**
   * Formata CPF
   */
  formatCPF(cpf) {
    if (!cpf) return '';
    const clean = cpf.replace(/\D/g, '');
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  /**
   * Formata CNPJ
   */
  formatCNPJ(cnpj) {
    if (!cnpj) return '';
    const clean = cnpj.replace(/\D/g, '');
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  /**
   * Converte data para extenso
   */
  dateToExtensive(date) {
    const months = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
    ];
    
    const d = new Date(date);
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    
    return `${day} de ${month} de ${year}`;
  }

  /**
   * Obtém mensagem de erro amigável
   */
  getErrorMessage(error) {
    if (error.properties && error.properties.errors) {
      const errors = error.properties.errors;
      const messages = errors.map(e => {
        if (e.type === 'tag_not_found') {
          return `Variável não encontrada nos dados: ${e.tag}`;
        }
        return e.message;
      });
      return messages.join(', ');
    }
    return error.message;
  }
}

module.exports = DocumentGenerator;