// Campos que ligante/diretivo podem editar no Portal do Membro e que a secretaria
// aprova em Correções de Cadastro. Usado por ambos os domínios.
const CAMPOS_MEUS_DADOS = {
  ligante: ['nome','data_nascimento','sexo','email','email_alternativo','whatsapp','rg','cpf','semestre','turma','catraca','orcid','tem_formacao','qual_formacao','habilidades','aceita_cargo','qual_cargo','contribuicao_grupo','ideia_inovadora','tema_interesse','porque_lauro','apresentacao'],
  diretivo: ['nome','rg','cpf','email','catraca','cargo','semestre_turma','orcid','data_nascimento','sexo','whatsapp','instagram','graduacao','ano_ingresso','onde_reside','transporte_proprio','tipo_transporte','disponibilidade','experiencia_urologia']
};

module.exports = { CAMPOS_MEUS_DADOS };
