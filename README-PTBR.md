# HostMaster + KeyRush — Versão 4.0

Esta entrega transforma a versão HTML anterior em uma aplicação preparada para persistência multiusuário com **Netlify + Supabase**. A instalação começa sem dados fictícios: nenhum imóvel, prestador, proprietário, chamado, lançamento financeiro, reserva ou serviço de catálogo é pré-cadastrado.

## O que a V4 conecta

- **Supabase Auth:** cadastro/login real de Proprietários e Prestadores. O perfil Gestor Master não pode ser escolhido no cadastro público; a promoção é feita manualmente no banco.
- **Supabase Database + RLS:** imóveis, catálogo de serviços, solicitações, fila de prestadores, localização, calendário, histórico financeiro e lançamentos do DRE.
- **Supabase Realtime:** atualiza chamados, imóveis, catálogo e calendário entre dispositivos conectados.
- **RPCs transacionais:** criar chamado, aceitar, cancelar e finalizar. Se o prestador cancelar depois de aceitar, o banco atribui o chamado ao próximo prestador da fila. O aceite é atômico para evitar que dois prestadores peguem o mesmo chamado.
- **Netlify Functions:** mantém o link iCal do Airbnb no servidor e importa o calendário sem expor a chave administrativa do Supabase no navegador.
- **Sincronização programada:** a função agendada consulta os calendários iCal a cada três horas. O botão “Salvar e sincronizar agora” executa uma atualização imediata.

## Arquivos

- `index.html` — interface HostMaster + KeyRush.
- `config.js` — URL do projeto Supabase e chave pública ANON/PUBLISHABLE.
- `v4-integration.js` — autenticação e integração do front-end.
- `supabase-schema.sql` — tabelas, políticas RLS, funções seguras e Realtime.
- `netlify/functions/sync-airbnb-calendar.mjs` — sincronização manual autenticada.
- `netlify/functions/sync-airbnb-calendars-scheduled.mjs` — sincronização automática a cada três horas.
- `netlify/functions/lib/ical-sync.mjs` — validação e leitura iCal.
- `.env.example` — modelo das variáveis privadas da Netlify.
- `netlify.toml` e `package.json` — configuração de publicação e dependências.

## Instalação passo a passo

### 1. Criar o projeto Supabase

1. Entre em https://supabase.com e crie um projeto.
2. Abra **SQL Editor**.
3. Cole e execute todo o conteúdo de `supabase-schema.sql`.
4. Em **Project Settings → API**, copie a Project URL e a chave pública `anon`/`publishable`.

### 2. Configurar o front-end

Abra `config.js` e substitua:

```js
window.HOSTMASTER_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "COLE_AQUI_SUA_CHAVE_ANON_OU_PUBLISHABLE"
};
```

Use somente a chave pública. **Nunca** coloque `service_role` nesse arquivo.

### 3. Criar o Gestor Master

1. No Supabase, abra **Authentication → Users → Add user**.
2. Crie o usuário com o e-mail e a senha do Gestor Master.
3. Depois de criado, execute no SQL Editor (substitua pelo e-mail real):

```sql
update public.profiles
set role = 'gestor'
where email = 'SEU_EMAIL_MASTER';
```

O cadastro público permite somente Proprietário e Prestador. Não compartilhe o usuário Master.

### 4. Configurar variáveis privadas na Netlify

Publique a pasta do projeto na Netlify. Em **Site configuration → Environment variables**, configure:

- `SUPABASE_URL` = URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` = chave `service_role` do Supabase.

A `service_role` fica somente no ambiente das funções Netlify. Nunca envie essa chave pelo chat, não coloque no HTML e não a publique no Git.

### 5. Publicar

1. Suba a pasta completa (não somente o `index.html`) para um repositório Git conectado à Netlify ou publique a pasta pelo método de deploy que preserve as Netlify Functions.
2. A Netlify instalará as dependências de `package.json` e publicará as funções.
3. Abra o site publicado e faça login.
4. Cadastre as contas reais de Proprietário e Prestador (ou contas temporárias de homologação); confirme os e-mails se a confirmação estiver habilitada no Supabase.
5. Cadastre os serviços e preços reais no catálogo Master, depois cadastre um imóvel e valide o fluxo de solicitação, aceite, cancelamento, encaminhamento e conclusão.

### 6. Conectar o calendário Airbnb

1. No anúncio Airbnb, abra o calendário e procure **Disponibilidade → Conectar calendários → Exportar calendário**.
2. Copie o link iCal `.ics` e cole no calendário do imóvel no HostMaster.
3. Clique em **Salvar e sincronizar agora**.
4. A Netlify também executará a sincronização programada a cada três horas, após o deploy da função agendada.

O link público do anúncio não substitui o link iCal. A sincronização iCal importa reservas para o HostMaster; ela não publica automaticamente os bloqueios manuais de volta no Airbnb. Para isso seria necessária uma integração de escrita/API ou exportação de calendário separada.

## Regras de acesso

- Proprietário: vê e gerencia somente os próprios imóveis, calendário, lançamentos e solicitações.
- Prestador: vê somente chamados oferecidos a ele ou atribuídos a ele; pode aceitar, cancelar o próprio atendimento e finalizar o serviço atribuído.
- Gestor Master: administra o catálogo, acompanha os chamados e acessa os dados de gestão.
- A fila de prestadores e as mudanças de estado são executadas por funções SQL seguras, não por alterações livres no navegador.

## Limitações e notas importantes

- Este pacote é uma **base pronta para configuração e publicação**, não está conectado ao seu projeto Supabase nem publicado na sua conta Netlify. Isso exige acesso às suas contas, que não foi fornecido.
- A chave pública do Supabase pode ficar no front-end somente porque as tabelas usam RLS. A chave `service_role` nunca pode ser exposta.
- A função iCal aceita apenas URLs HTTPS de domínios Airbnb permitidos e `.ics`; o conteúdo é lido no servidor.
- O agendamento Netlify depende de deploy das Functions e do plano/ambiente Netlify que ofereça Scheduled Functions.
- Para produção, configure confirmação de e-mail, política de senha, domínio HTTPS, backups do Supabase, monitoramento e teste as políticas RLS com contas separadas de Proprietário, Prestador e Gestor.
- O pacote não contém contas ou cadastros de demonstração. Dados antigos do navegador não são migrados. Crie as contas e cadastros reais pelo Supabase/painel.


## Inicialização limpa

O script SQL não insere serviços de exemplo. Após criar o usuário Gestor Master e entrar no painel, cadastre o catálogo e os preços oficiais. Em seguida, os proprietários podem cadastrar seus imóveis e solicitar os serviços. Esta versão não apaga registros já existentes em um projeto Supabase: para uma instalação limpa, use um projeto novo.
