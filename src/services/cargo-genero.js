// Converte os cargos genericos (com "(a)") cadastrados em diretivos para a forma
// masculina ou feminina, de acordo com o sexo da pessoa, para exibicao publica
// (perfil publico, story de aniversario). Se o cargo ou o sexo nao forem reconhecidos,
// mantem o texto original sem alteracao.
const MAPA = {
  'Presidente(a)': { Masculino: 'Presidente', Feminino: 'Presidenta' },
  'Vice-presidente(a)': { Masculino: 'Vice-presidente', Feminino: 'Vice-presidenta' },
  'Secretário(a)': { Masculino: 'Secretário', Feminino: 'Secretária' },
  'Diretor(a) Financeiro(a)': { Masculino: 'Diretor Financeiro', Feminino: 'Diretora Financeira' },
  'Diretor(a) Científico': { Masculino: 'Diretor Científico', Feminino: 'Diretora Científica' },
  'Vice Diretor(a) Científico': { Masculino: 'Vice Diretor Científico', Feminino: 'Vice Diretora Científica' },
  'Diretor(a) de Extensão': { Masculino: 'Diretor de Extensão', Feminino: 'Diretora de Extensão' },
  'Vice Diretor(a) de Extensão': { Masculino: 'Vice Diretor de Extensão', Feminino: 'Vice Diretora de Extensão' },
  'Diretor(a) de Ensino': { Masculino: 'Diretor de Ensino', Feminino: 'Diretora de Ensino' },
  'Vice Diretor(a) de Ensino': { Masculino: 'Vice Diretor de Ensino', Feminino: 'Vice Diretora de Ensino' },
  'Diretor(a) de Marketing': { Masculino: 'Diretor de Marketing', Feminino: 'Diretora de Marketing' },
  'Vice Diretor(a) de Marketing': { Masculino: 'Vice Diretor de Marketing', Feminino: 'Vice Diretora de Marketing' }
};

function cargoComGenero(cargo, sexo) {
  if (!cargo) return cargo;
  const variantes = MAPA[cargo];
  if (!variantes) return cargo;
  return variantes[sexo] || cargo;
}

module.exports = { cargoComGenero };
