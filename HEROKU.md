# Deploy no Heroku

O projeto está preparado para rodar em um único dyno web: o processo Node serve a API e, em produção, também serve o build do React.

## Configuração

1. Crie um app no Heroku e adicione o **Heroku Postgres antes do primeiro deploy**:

   ```bash
   heroku create SEU_APP
   heroku addons:create heroku-postgresql:essential-0 -a SEU_APP
   ```

   O add-on cria automaticamente a Config Var `DATABASE_URL`. Se você usar um
   Postgres externo, configure essa variável manualmente:

   ```bash
   heroku config:set DATABASE_URL='postgresql://...' -a SEU_APP
   ```

   Confirme que a variável existe antes de fazer o push:

   ```bash
   heroku config:get DATABASE_URL -a SEU_APP
   ```

   Nunca coloque esse valor no repositório ou em arquivos versionados.

2. Faça o deploy do repositório:

   ```bash
   heroku git:remote -a SEU_APP
   git push heroku main
   ```

3. Configure as variáveis no Heroku Config Vars:

   - `DATABASE_URL`: fornecida pelo Heroku Postgres.
   - `SESSION_SECRET`: valor aleatório longo para assinar as sessões.
   - `APP_LOGIN_PASSWORD`: senha do login da aplicação.
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: token escolhido no painel da Meta.
   - `WHATSAPP_GRAPH_VERSION`: opcional; o padrão do projeto é `v23.0`.
   - `WHATSAPP_ESTIMATED_COST_PER_MESSAGE`: opcional.
   - `WHATSAPP_ESTIMATED_COST_CURRENCY`: opcional; o padrão é `BRL`.

   Os dados da conta WhatsApp conectada são configurados pela tela de configurações e persistidos no banco.

4. O Heroku instala a versão de pnpm declarada em `packageManager`, executa o build pelo `heroku-postbuild` e roda o `release` do `Procfile` para aplicar o schema do banco antes de iniciar o dyno web.
5. No painel da Meta, configure o callback para:

   ```text
   https://SEU_APP.herokuapp.com/api/webhook
   ```

   Use o mesmo `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e assine o campo `messages`.

## Login persistente

Na tela de login, marcar **Manter conectado por 30 dias** cria um cookie HTTP-only com validade de 30 dias. Sem marcar, a sessão é temporária e o token expira em 12 horas.

## Reinícios e segurança

- A conexão com a Meta é persistida no Postgres; o access token é armazenado criptografado usando `SESSION_SECRET` e nunca é enviado ao frontend.
- Não altere `SESSION_SECRET` depois de salvar uma conexão sem antes reconectar a conta, porque os tokens persistidos não poderão ser descriptografados com a nova chave.
- O dyno web usa a porta `PORT` fornecida pelo Heroku e serve a API e o build do React no mesmo processo.

## Verificação após o deploy

```bash
heroku logs --tail -a SEU_APP
curl https://SEU_APP.herokuapp.com/api/healthz
```

O health check deve responder `{"status":"ok"}`. A tela principal pode exigir login, enquanto `/api/healthz` permanece público para monitoramento.

## Erro `DATABASE_URL, ensure the database is provisioned`

Esse erro acontece quando o `release` foi executado sem uma Config Var
`DATABASE_URL`. O banco é obrigatório: o backend também não inicia sem ele.

No app correto, execute:

```bash
heroku addons:create heroku-postgresql:essential-0 -a SEU_APP
heroku config:get DATABASE_URL -a SEU_APP
git push heroku main
```

Se o Postgres já existe, verifique se ele está associado a este app e se a
variável não foi removida:

```bash
heroku addons -a SEU_APP
heroku config -a SEU_APP
```

Não remova a etapa `release` do `Procfile`: ela aplica o schema necessário
antes do dyno web iniciar.

## Observações

- O app precisa estar em modo Live na Meta para receber clientes fora dos números de teste.
- O processo usa a porta fornecida pelo Heroku através de `PORT`.
- Não coloque tokens da Meta, senhas ou `DATABASE_URL` no repositório.