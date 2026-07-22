# CLAUDE.md

Regras permanentes deste projeto. Valem para TODO o projeto e devem ser respeitadas em qualquer alteração.

## Modularização, Responsabilidade e Limites entre Módulos

- Preserve a arquitetura modular existente.
- Cada módulo deve possuir uma responsabilidade claramente definida.
- Não misture regras de domínio, acesso a dados, interface e infraestrutura no mesmo arquivo.
- Evite criar dependências diretas entre módulos que não tenham relação explícita.
- Use as interfaces públicas do módulo em vez de acessar arquivos internos.
- Não mova responsabilidades entre módulos sem analisar todos os consumidores.
- Prefira alta coesão dentro do módulo e baixo acoplamento entre módulos.
- Não crie arquivos genéricos como `utils.ts`, `helpers.ts` ou `common.ts` para responsabilidades sem relação.
- Antes de criar um novo módulo, verifique se a responsabilidade pertence a um módulo já existente.
- Alterações devem respeitar os limites arquiteturais e os padrões de importação do projeto.
