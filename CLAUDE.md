# iPlex Web — regras do repositório

## Testes de interface e navegação

- **Todos os testes de interface, foco, rolagem e navegação devem ser feitos na TV física conectada** (Samsung, via shell do iPlex Player), com a conta já logada. Roteiro: `src/platform/tvSelfTest.ts` (`?diag=1&selftest=1`) e `npm run tv` no repositório `aliens-syndicate-iplex-app`; documentação em `docs/`.
- **Só use o dispositivo web** (navegador/Vite, com ou sem mocks) **quando o usuário disser que a TV não está disponível.** Os testes automatizados (`npm test`) continuam obrigatórios, mas não substituem a validação na TV.
- Ao terminar um teste na TV, reinstale o shell de produção (`npm run tv` no repositório do App).
- Sem commit, push ou deploy sem autorização do usuário.
