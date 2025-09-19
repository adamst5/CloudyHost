# 🚀 Deploy no Render - Passo a Passo

## Pré-requisitos
- Conta no GitHub
- Conta no Render (gratuita)
- Código no GitHub

## 1️⃣ Preparar Repositório GitHub

1. **Criar repositório no GitHub**
2. **Push o código** para o GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
git push -u origin main
```

## 2️⃣ Criar Banco PostgreSQL no Render

1. Acesse [render.com](https://render.com) e faça login
2. Clique **"New"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `cloudy-host-db`
   - **Plan**: **Free**
   - **Region**: Escolha mais próxima (US East recomendada)
4. Clique **"Create Database"**
5. **Copie a "Internal Database URL"** (vai precisar depois)

## 3️⃣ Criar Web Service

1. Clique **"New"** → **"Web Service"**
2. **Conecte ao GitHub** e selecione seu repositório
3. Configure:
   - **Name**: `cloudy-host` (ou qualquer nome)
   - **Region**: **Mesma região do banco**
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm run dev`
   - **Plan**: **Free**

## 4️⃣ Configurar Variáveis de Ambiente

Na seção **"Environment Variables"**, adicione:

```
DATABASE_URL = [Cole a Internal Database URL do seu PostgreSQL]
NODE_ENV = production
SESSION_SECRET = [Gere uma chave secreta forte de 64+ caracteres]
DISCORD_CLIENT_ID = [Seu Discord Client ID aqui]
DISCORD_CLIENT_SECRET = [Seu Discord Client Secret aqui]  
DISCORD_CALLBACK_URL = https://SEU-APP.onrender.com/auth/discord/callback
```

⚠️ **IMPORTANTE**: 
- **NÃO** defina a variável `PORT` - o Render define automaticamente
- Use suas próprias credenciais do Discord (não as do exemplo)
- Para gerar SESSION_SECRET seguro: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

⚠️ **Importante**: Substitua `SEU-APP` pela URL real que o Render irá gerar

## 5️⃣ Atualizar Discord OAuth

1. Acesse [Discord Developer Portal](https://discord.com/developers/applications)
2. Vá em **OAuth2** → **General**
3. **Adicione** a nova URL de callback:
   - `https://SEU-APP.onrender.com/auth/discord/callback`

## 6️⃣ Deploy e Teste

1. Clique **"Create Web Service"**
2. Aguarde o build (5-10 minutos)
3. Teste sua aplicação na URL fornecida
4. Teste o login com Discord

## 🔧 Solução de Problemas

### Erro de Banco de Dados
- Verifique se `DATABASE_URL` está correto
- Use a **Internal Database URL**, não a External

### Erro de OAuth
- Confirme se `DISCORD_CALLBACK_URL` está correto
- Verifique se adicionou a URL no Discord Developer Portal

### App não carrega
- Verifique os logs no dashboard do Render
- Confirme se todas as variáveis de ambiente estão definidas

## 💰 Limitações Gratuitas

- **PostgreSQL**: Expira em 90 dias, apenas 1 instância
- **Web Service**: Hiberna após 15 minutos sem uso
- **Bandwidth**: 100GB/mês

## ✅ Pronto!
Sua aplicação estará rodando em: `https://SEU-APP.onrender.com`