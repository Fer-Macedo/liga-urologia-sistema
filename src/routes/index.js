router.post('/webhook/pagbank', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let body;
    try { body = JSON.parse(req.body.toString()); }
    catch (e) { console.error('Webhook JSON erro:', e.message); return res.sendStatus(200); }
    console.log('Webhook recebido:', JSON.stringify(body).substring(0,200));
    const isSandbox = (process.env.PAGBANK_BASE_URL || '').includes('sandbox');
    if (isSandbox) { console.log('Webhook ignorado - Sandbox'); return res.sendStatus(200); }
    if (body.charges && body.charges[0] && body.charges[0].status === 'PAID') {
      const ref = body.charges[0].reference_id || body.charges[0].id;
      let r = await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE referencia=$1 AND status!='pago'", [ref]);
      if (r.rowCount === 0) await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW() WHERE pagbank_charge_id=$1 AND status!='pago'", [ref]);
      console.log('Pagamento confirmado:', ref);
    }
  } catch (e) { console.error('Webhook erro:', e.message); }
  res.sendStatus(200);
});
module.exports = router;
