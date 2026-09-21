# Deploy no Heroku

O projeto está preparado para rodar em um único dyno web: o processo Node serve a API e, em produção, também serve o build do React.

## Configuração

1. Crie um app no Heroku e adicione o **Heroku Postgres**.
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

4. O Heroku usa o `Procfile` e executa o build pelo `heroku-postbuild`.
5. No painel da Meta, configure o callback para:

   ```text
   https://SEU_APP.herokuapp.com/api/webhook
   ```

   Use o mesmo `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e assine o campo `messages`.

## Login persistente

Na tela de login, marcar **Manter conectado por 30 dias** cria um cookie HTTP-only com validade de 30 dias. Sem marcar, a sessão é temporária e o token expira em 12 horas.

## Observações

- O app precisa estar em modo Live na Meta para receber clientes fora dos números de teste.
- O processo usa a porta fornecida pelo Heroku através de `PORT`.
- Não coloque tokens da Meta, senhas ou `DATABASE_URL` no repositório.