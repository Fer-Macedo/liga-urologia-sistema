require('dotenv').config();
const { Pool } = require('pg');
const { criarCobranca } = require('./src/services/pagbank');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT c.id, c.referencia, c.valor_cheio, c.data_vencimento,
           m.nome, m.cpf, m.email
    FROM cobrancas c
    JOIN membros m ON m.id = c.membro_id
    WHERE c.status = 'pendente' AND c.pagbank_charge_id IS NULL
    ORDER BY c.id
  `);

  console.log(`Gerando PIX para ${rows.length} cobranças...`);

  for (const c of rows) {
    try {
      console.log(`\nProcessando: ${c.nome} (ref: ${c.referencia})`);
      const result = await criarCobranca({
        membro: { nome: c.nome, cpf: c.cpf, email: c.email },
        valor: c.valor_cheio,
        vencimento: c.data_vencimento,
        referencia: c.referencia
      });

      if (result && result.ok && result.charge_id) {
        await pool.query(`
          UPDATE cobrancas SET
            pagbank_charge_id = $1,
            pix_copia_cola = $2,
            pix_qr_image = $3,
            pagbank_link = $4
          WHERE id = $5
        `, [result.charge_id, result.pix_copia_cola, result.pix_qr_image, result.checkout_link, c.id]);
        console.log(`✅ OK: ${c.nome} — charge: ${result.charge_id}`);
      } else {
        console.log(`❌ ERRO: ${c.nome} — ${JSON.stringify(result)}`);
      }
    } catch (e) {
      console.error(`❌ ERRO ${c.nome}:`, e.message);
    }
  }

  await pool.end();
  console.log('\nConcluído!');
}

main();
