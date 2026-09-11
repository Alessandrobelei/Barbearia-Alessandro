# Barbearia Alessandro — sistema automático

## O que este projeto faz
- Site público em `/`
- Painel administrativo em `/admin.html`
- Dados salvos no servidor em `data.json`
- Alterações no painel aparecem no site automaticamente
- Agendamentos são registrados no servidor
- O cliente escolhe dia, horário e serviço antes de abrir o WhatsApp
- Horários ocupados deixam de aparecer como disponíveis
- Senha do painel configurável pela variável `ADMIN_PASSWORD`

## Rodar no computador
1. Instale Node.js 18+.
2. Abra o terminal nesta pasta.
3. Rode `npm start`.
4. Abra `http://localhost:3000`.
5. Painel: `http://localhost:3000/admin.html`
6. Senha padrão: `1234`

## Publicar na internet
Este projeto precisa ser colocado em uma hospedagem que execute Node.js e permita gravação do `data.json` (ou, para produção mais robusta, trocar o arquivo por um banco de dados).
Ao publicar, configure:
- `ADMIN_PASSWORD` = uma senha forte
- `PORT` normalmente é fornecida pela hospedagem

## Importante
O WhatsApp usado é +55 14 99828-8661. O número pode ser alterado no painel.
