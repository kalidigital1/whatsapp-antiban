# Deploy no Heroku

O projeto está preparado para rodar em um único dyno web: o processo Node serve a API e, em produção, também serve o build do React.

## Configuração

1. Crie o app no Heroku e escolha o banco que ele usará:

   ```bash
   heroku create SEU_APP
   ```

   Se for usar Heroku Postgres, adicione o add-on; ele cria `DATABASE_URL`:

   ```bash
   heroku addons:create heroku-postgresql:essential-0 -a SEU_APP
   ```

   Se for usar Neon ou outro PostgreSQL externo, não é necessário adicionar Heroku
   Postgres; configure `EXTERNAL_DATABASE_URL` nas Config Vars conforme o passo 3.
   Não imprima nem compartilhe valores de conexão.

2. Faça o deploy do repositório:

   ```bash
   heroku git:remote -a SEU_APP
   git push heroku main
   ```

3. Configure as variáveis no Heroku Config Vars:

   - `EXTERNAL_DATABASE_URL`: conexão da Neon ou outro PostgreSQL externo. Tem prioridade sobre `DATABASE_URL`.
   - `DATABASE_URL`: criada pelo add-on Heroku Postgres, caso esse seja o banco escolhido. Só é usada quando `EXTERNAL_DATABASE_URL` não está definida.
   - `SESSION_SECRET`: valor aleatório longo para assinar as sessões.
   - `APP_LOGIN_PASSWORD`: senha do login da aplicação.
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: token escolhido no painel da Meta.
   - `WHATSAPP_GRAPH_VERSION`: opcional; o padrão do projeto é `v23.0`.
   - `WHATSAPP_ESTIMATED_COST_PER_MESSAGE`: opcional.
   - `WHATSAPP_ESTIMATED_COST_CURRENCY`: opcional; o padrão é `BRL`.
   - `EVOLUTION_API_URL`: URL base do serviço usado para conectar pelo QR Code.
   - `EVOLUTION_API_KEY`: chave desse serviço, mantida somente nas Config Vars.
   - `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY`: credenciais do Cloudflare R2 para uploads e mídias no Heroku. Configure todas as quatro; não reutilize as credenciais do Replit.

   Os dados da conta WhatsApp conectada são configurados pela tela de configurações e persistidos no banco. Secrets do Replit não são copiados para o Heroku; configure-os novamente nas Config Vars do app. Se `EXTERNAL_DATABASE_URL` e `DATABASE_URL` estiverem ambas definidas, a Neon será o banco usado pelo app e pelo release.

4. O Heroku instala a versão de pnpm declarada em `packageManager`, executa o build pelo `heroku-postbuild` e roda o `release` do `Procfile` antes de iniciar o dyno web. O release aplica o schema, sem `--force`, ao banco selecionado pelas Config Vars. O `drizzle-kit` fica nas dependências de produção porque o release precisa dele. O comando está em modo verbose para que erros e operações de schema apareçam nos logs.

   **Importante:** esse `push` pode alterar o schema do banco de produção em cada release. Não use `push-force` em produção: ele pode aprovar automaticamente operações com perda de dados. Faça backup do banco antes de mudanças de schema. O projeto ainda não tem um histórico de migrações versionadas; migrar para `drizzle-kit migrate` exige criar um baseline compatível com o estado atual do banco, sem reaplicar a criação das tabelas existentes.

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

## Erro de conexão ou permissão no release

O release usa `EXTERNAL_DATABASE_URL` se ela existir; caso contrário, usa
`DATABASE_URL`. Assim, ter as duas variáveis não faz o app alternar entre bancos.
Confirme no painel do Heroku apenas qual variável está definida, sem copiar o
valor para logs ou chat. A role da conexão precisa ter permissões para as
alterações de schema necessárias.

Se o release falhar, consulte a saída completa da fase **release** em Activity.
O aviso de SSL do `pg-connection-string` não identifica a causa por si só. Não
use `push-force` como tentativa de correção.

## Erro `EXTERNAL_DATABASE_URL or DATABASE_URL must be set`

Esse erro acontece quando nenhuma das Config Vars de banco está definida. Para
Neon, configure `EXTERNAL_DATABASE_URL`; para Heroku Postgres, o add-on fornece
`DATABASE_URL`. Se ambas existirem, `EXTERNAL_DATABASE_URL` tem prioridade.
Confira apenas a presença da variável no painel, sem copiar ou imprimir o valor.

Só crie o add-on abaixo se a escolha for Heroku Postgres:

```bash
heroku addons:create heroku-postgresql:essential-0 -a SEU_APP
git push heroku main
```

Se usar Neon, configure a variável em **Settings → Config Vars** no app Heroku
e depois faça um novo deploy. Não compartilhe o valor da URL.

Não remova a etapa `release` do `Procfile` sem confirmar que o schema já está
aplicado; o dyno web depende das tabelas existentes.

## Observações

- O app precisa estar em modo Live na Meta para receber clientes fora dos números de teste.
- O processo usa a porta fornecida pelo Heroku através de `PORT`.
- Não coloque tokens da Meta, senhas ou `DATABASE_URL` no repositório.