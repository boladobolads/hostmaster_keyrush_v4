# HostMaster Access — ambiente independente

Este diretório é a primeira versão isolada do módulo Access. Ele não é carregado pelo `index.html` principal e não depende do banco do HostMaster + KeyRush V4.

## Arquivos
- `index.html`: interface standalone.
- `access.js`: autenticação e cadastro de imóveis/equipamentos.
- `config.example.js`: modelo de configuração; copie para `config.js`.
- `schema.sql`: estrutura do NOVO Supabase.

## Implantação segura
1. Crie um projeto Supabase novo, separado do projeto V4.
2. No SQL Editor desse projeto novo, execute `schema.sql`.
3. Em Authentication > Users, crie o usuário inicial.
4. Copie `config.example.js` para `config.js` e preencha URL e chave publishable/anon do NOVO projeto.
5. Publique somente este diretório como site independente (ou configure o deploy para usar esta pasta como base/publicação).
6. Teste login, cadastro de imóvel e cadastro de mais de um dispositivo por imóvel.

## Limitações deliberadas da v1
Não envia comandos para AGL ou Primebras, não cria links públicos de abertura e não gera senhas temporárias. Esses recursos exigem validar modelo, protocolo/API oficial e implementar endpoints backend com autorização, expiração, proteção contra repetição e auditoria. Nunca coloque service_role ou credenciais de fabricantes no navegador.

## Integração futura
A conexão com o HostMaster V4 será planejada depois da validação independente, sem copiar credenciais nem alterar o sistema principal.