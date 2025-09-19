// middleware/security.js
const crypto = require('crypto');

class SecurityMiddleware {
  /**
   * Validar API Key e extrair Tenant ID
   */
  static validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    
    if (!apiKey) {
      return res.status(401).json({ 
        error: 'API Key required',
        message: 'Missing x-api-key header' 
      });
    }

    try {
      // Formato da API Key: base64(tenantId:secret:timestamp)
      const decoded = Buffer.from(apiKey.replace('Bearer ', ''), 'base64').toString();
      const [tenantId, secret, timestamp] = decoded.split(':');
      
      // Validar timestamp (não pode ser muito antigo)
      const keyAge = Date.now() - parseInt(timestamp);
      if (keyAge > 86400000) { // 24 horas
        return res.status(401).json({ error: 'API Key expired' });
      }
      
      // Validar secret (em produção, verificar contra banco de dados)
      const expectedSecret = process.env[`TENANT_SECRET_${tenantId}`];
      if (secret !== expectedSecret) {
        return res.status(401).json({ error: 'Invalid API Key' });
      }
      
      // Adicionar tenant ID ao request
      req.tenantId = tenantId;
      req.tenantInfo = {
        id: tenantId,
        isolated: true,
        createdAt: new Date(parseInt(timestamp))
      };
      
      console.log(`✅ Request autorizado para tenant: ${tenantId}`);
      next();
      
    } catch (error) {
      console.error('❌ Erro na validação:', error);
      return res.status(401).json({ error: 'Invalid API Key format' });
    }
  }

  /**
   * Isolar caminhos de arquivo por tenant
   */
  static isolateTenantPaths(req, res, next) {
    if (!req.tenantId) {
      return res.status(500).json({ error: 'Tenant ID not set' });
    }
    
    // Criar estrutura isolada para cada tenant
    req.tenantPaths = {
      templates: `tenants/${req.tenantId}/templates`,
      documents: `tenants/${req.tenantId}/documents`,
      temp: `tenants/${req.tenantId}/temp`,
      logs: `tenants/${req.tenantId}/logs`
    };
    
    next();
  }

  /**
   * Sanitizar dados sensíveis
   */
  static sanitizeData(req, res, next) {
    // Remover dados sensíveis dos logs
    if (req.body) {
      const sanitized = { ...req.body };
      
      // Lista de campos sensíveis
      const sensitiveFields = ['cpf', 'cnpj', 'rg', 'senha', 'password', 'token'];
      
      for (const field of sensitiveFields) {
        if (sanitized[field]) {
          sanitized[field] = '***REDACTED***';
        }
        
        // Verificar também em objetos aninhados
        if (sanitized.data && sanitized.data[field]) {
          sanitized.data[field] = '***REDACTED***';
        }
      }
      
      // Salvar versão sanitizada para logs
      req.sanitizedBody = sanitized;
    }
    
    next();
  }

  /**
   * Criptografar documentos sensíveis
   */
  static encryptDocument(tenantId, buffer) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(
      process.env.ENCRYPTION_KEY || 'default-key',
      tenantId,
      32
    );
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Descriptografar documentos
   */
  static decryptDocument(tenantId, encryptedData, iv, authTag) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(
      process.env.ENCRYPTION_KEY || 'default-key',
      tenantId,
      32
    );
    
    const decipher = crypto.createDecipheriv(
      algorithm, 
      key, 
      Buffer.from(iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    return Buffer.concat([
      decipher.update(encryptedData),
      decipher.final()
    ]);
  }

  /**
   * Rate limiting por tenant
   */
  static rateLimiter(req, res, next) {
    const tenantId = req.tenantId;
    
    // Armazenar contadores em memória (em produção, usar Redis)
    if (!global.rateLimits) {
      global.rateLimits = {};
    }
    
    if (!global.rateLimits[tenantId]) {
      global.rateLimits[tenantId] = {
        count: 0,
        resetTime: Date.now() + 60000 // 1 minuto
      };
    }
    
    const limit = global.rateLimits[tenantId];
    
    // Reset se passou o tempo
    if (Date.now() > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = Date.now() + 60000;
    }
    
    // Verificar limite (30 requests por minuto por tenant)
    if (limit.count >= 30) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((limit.resetTime - Date.now()) / 1000)
      });
    }
    
    limit.count++;
    next();
  }

  /**
   * Audit log
   */
  static auditLog(req, res, next) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      tenantId: req.tenantId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      body: req.sanitizedBody || {}
    };
    
    // Em produção, salvar em banco de dados separado por tenant
    console.log('📝 Audit:', JSON.stringify(logEntry));
    
    // Salvar em arquivo por tenant (opcional)
    const fs = require('fs').promises;
    const logPath = `${req.tenantPaths?.logs || 'logs'}/audit-${new Date().toISOString().split('T')[0]}.log`;
    
    fs.appendFile(logPath, JSON.stringify(logEntry) + '\n').catch(err => {
      console.error('Erro ao salvar log:', err);
    });
    
    next();
  }
}

module.exports = SecurityMiddleware;