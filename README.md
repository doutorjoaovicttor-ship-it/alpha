# Alpha Sistema Empresarial

Sistema administrativo da Alpha Serviços de Limpeza.

## Local

```powershell
npm.cmd start
```

Acesse `http://localhost:3333`.

## Netlify

O projeto já está configurado para Netlify:

- `public/` é o frontend publicado.
- `netlify/functions/api.js` é a API serverless.
- `netlify.toml` redireciona `/api/*` para a function.
- Os dados online ficam salvos no Netlify Blobs.

Configuração do deploy:

```text
Build command: deixar vazio
Publish directory: public
Functions directory: netlify/functions
```

Variáveis de ambiente recomendadas na Netlify:

```text
ADMIN_EMAIL=seu-email
ADMIN_PASSWORD=sua-senha-forte
SESSION_SECRET=uma-chave-grande-aleatoria
```

Se não configurar, o login padrão será:

```text
Email: admin@alpha.com
Senha: Alpha@2026
```

## Banco local antigo

O modo local com `server.js` ainda usa SQLite em `data/alpha.db`. A versão Netlify usa Netlify Blobs, porque SQLite local não é persistente em serverless.
