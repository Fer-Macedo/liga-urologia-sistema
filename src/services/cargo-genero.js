// Converte os cargos genericos (cadastrados internamente em portugues, com "(a)")
// para o titulo em ESPANHOL e com o genero correto, de acordo com o sexo da pessoa,
// para qualquer texto exibido ao publico externo (perfil publico, story/arte de
// aniversario, API da equipe publica) - exigencia da universidade (site em espanhol).
// Sem "sexo" cadastrado, cai no masculino (forma neutra padrao).
const MAPA = {
  'Presidente(a)': { Masculino: 'Presidente', Feminino: 'Presidenta' },
  'Vice-presidente(a)': { Masculino: 'Vicepresidente', Feminino: 'Vicepresidenta' },
  'Secretário(a)': { Masculino: 'Secretario', Feminino: 'Secretaria' },
  'Diretor(a) Financeiro(a)': { Masculino: 'Director Financiero', Feminino: 'Directora Financiera' },
  'Diretor(a) Científico': { Masculino: 'Director Científico', Feminino: 'Directora Científica' },
  'Vice Diretor(a) Científico': { Masculino: 'Vicedirector Científico', Feminino: 'Vicedirectora Científica' },
  'Diretor(a) de Extensão': { Masculino: 'Director de Extensión', Feminino: 'Directora de Extensión' },
  'Vice Diretor(a) de Extensão': { Masculino: 'Vicedirector de Extensión', Feminino: 'Vicedirectora de Extensión' },
  'Diretor(a) de Ensino': { Masculino: 'Director de Enseñanza', Feminino: 'Directora de Enseñanza' },
  'Vice Diretor(a) de Ensino': { Masculino: 'Vicedirector de Enseñanza', Feminino: 'Vicedirectora de Enseñanza' },
  'Diretor(a) de Marketing': { Masculino: 'Director de Marketing', Feminino: 'Directora de Marketing' },
  'Vice Diretor(a) de Marketing': { Masculino: 'Vicedirector de Marketing', Feminino: 'Vicedirectora de Marketing' }
};

function cargoComGenero(cargo, sexo) {
  if (!cargo) return cargo;
  const variantes = MAPA[cargo];
  if (!variantes) return cargo;
  return variantes[sexo] || variantes.Masculino;
}

module.exports = { cargoComGenero };
