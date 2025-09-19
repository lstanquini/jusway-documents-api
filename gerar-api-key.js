// gerar-api-key.js
// Este arquivo cria uma API Key para teste

// Configurações (você pode mudar estes valores)
const tenantId = 'base44';  // Nome do cliente
const secret = 'senha123';   // Senha (invente uma)

// Hora atual (automático)
const timestamp = Date.now();

// Juntar tudo
const token = tenantId + ':' + secret + ':' + timestamp;

// Converter para código especial (Base64)
const apiKey = Buffer.from(token).toString('base64');

// Mostrar a chave
console.log('========================');
console.log('SUA API KEY FOI CRIADA:');
console.log(apiKey);
console.log('========================');
console.log('');
console.log('Copie a chave acima e use nos testes');