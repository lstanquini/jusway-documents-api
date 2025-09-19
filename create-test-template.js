const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');

// Criar um documento DOCX mínimo válido
const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>CONTRATO DE TESTE</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>Cliente: {{nome_cliente}}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>CPF: {{cpf}}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>Valor: {{valor}}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

console.log('Template criado com variáveis: nome_cliente, cpf, valor');
