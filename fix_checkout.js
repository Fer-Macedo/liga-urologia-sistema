const { query } = require('./src/models/database');
const { criarCheckoutLink } = require('./src/services/pagbank');

(async()=>{
  const r = await query(`
    SELECT c.id, c.referencia, c.valor_desconto, c.data_vencimento,
           m.nome, m.email, m.cpf
    FROM cobrancas c JOIN membros m ON m.id=c.membro_id
    WHERE c.status='pendente' AND c.data_vencimento::date='2026-06-15'
    AND (c.pagbank_link IS NULL OR c.pagbank_link='')
  `);
  console.log('Gerando checkout para:', r.rows.length, 'cobranças');
  let ok=0, erro=0;
  for(const cob of r.rows){
    try{
      const expDate = new Date(cob.data_vencimento).toISOString().replace('.000Z','').replace('Z','') + '-03:00';
      const link = await criarCheckoutLink({
        nome: cob.nome,
        email: cob.email,
        cpf: cob.cpf,
        valor: parseFloat(cob.valor_desconto),
        referencia: cob.referencia,
        descricao: 'Mensalidade Liga Academica de Urologia',
        expDate
      });
      if(link){
        await query('UPDATE cobrancas SET pagbank_link=$1 WHERE id=$2', [link, cob.id]);
        ok++;
        process.stdout.write('.');
      } else {
        console.log('\nSem link:', cob.nome);
        erro++;
      }
      await new Promise(r=>setTimeout(r,500));
    }catch(e){
      console.error('\nERRO:', cob.nome, e.message);
      erro++;
    }
  }
  console.log('\nOK:',ok,'ERRO:',erro);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
