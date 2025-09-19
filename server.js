const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware básico
app.use(express.json());

// Rotas
app.get('/', (req, res) => {
  res.send('JusWay API funcionando!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT });
});

// Escutar em todas as interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
