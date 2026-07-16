// ═══ ASSISTENTE VIRTUAL ═════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

router.get('/assistente-virtual/uso', requireAuth, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const mes = hoje.substring(0, 7);
    const [total, mes_r, hoje_r, cfg_saldo, cfg_data] = await Promise.all([
      query('SELECT SUM(tokens_entrada+tokens_saida) as tokens, SUM(custo_estimado) as custo, COUNT(*) as chamadas FROM anthropic_uso'),
      query("SELECT SUM(tokens_entrada+tokens_saida) as tokens, SUM(custo_estimado) as custo, COUNT(*) as chamadas FROM anthropic_uso WHERE TO_CHAR(criado_em,'YYYY-MM')=$1", [mes]),
      query("SELECT SUM(tokens_entrada+tokens_saida) as tokens, SUM(custo_estimado) as custo, COUNT(*) as chamadas FROM anthropic_uso WHERE criado_em::date=$1", [hoje]),
      query("SELECT valor FROM configuracoes WHERE chave='anthropic_saldo_inicial'"),
      query("SELECT valor FROM configuracoes WHERE chave='anthropic_saldo_data'"),
    ]);
    const saldo_inicial = parseFloat(cfg_saldo.rows[0]?.valor)||0;
    const saldo_data = cfg_data.rows[0]?.valor||null;
    let consumido_desde_saldo = 0;
    if (saldo_data) {
      const desde = await query("SELECT SUM(custo_estimado) as custo FROM anthropic_uso WHERE criado_em>=$1", [saldo_data]);
      consumido_desde_saldo = parseFloat(desde.rows[0]?.custo)||0;
    }
    res.json({
      total: { tokens: parseInt(total.rows[0].tokens)||0, custo: parseFloat(total.rows[0].custo)||0, chamadas: parseInt(total.rows[0].chamadas)||0 },
      mes: { tokens: parseInt(mes_r.rows[0].tokens)||0, custo: parseFloat(mes_r.rows[0].custo)||0, chamadas: parseInt(mes_r.rows[0].chamadas)||0 },
      hoje: { tokens: parseInt(hoje_r.rows[0].tokens)||0, custo: parseFloat(hoje_r.rows[0].custo)||0, chamadas: parseInt(hoje_r.rows[0].chamadas)||0 },
      saldo_inicial, saldo_data, consumido_desde_saldo
    });
  } catch(e) {
    console.error('[USO API] erro ao carregar uso:', e.message);
    res.json({ total:{tokens:0,custo:0,chamadas:0}, mes:{tokens:0,custo:0,chamadas:0}, hoje:{tokens:0,custo:0,chamadas:0}, saldo_inicial:0, saldo_data:null, consumido_desde_saldo:0 });
  }
});

router.post('/assistente-virtual/saldo', requireAuth, async (req, res) => {
  try {
    const saldo = parseFloat(req.body.saldo)||0;
    const agora = new Date().toISOString();
    await query("INSERT INTO configuracoes(chave,valor) VALUES('anthropic_saldo_inicial',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [saldo.toString()]);
    await query("INSERT INTO configuracoes(chave,valor) VALUES('anthropic_saldo_data',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [agora]);
    res.json({ok:true});
  } catch(e) {
    console.error('[USO API] erro ao salvar saldo:', e.message);
    res.json({ok:false});
  }
});
router.get('/assistente-virtual', requireAuth, requirePermissao('assistente-virtual'), async (req, res) => {
  try {
    const config = await getConfig();
    const r = await query('SELECT id, pergunta, resposta, ativo FROM lauro_conhecimento ORDER BY id DESC LIMIT 200');
    res.render('pages/assistente-virtual', {
      config, conhecimento: r.rows,
      usuario: req.session.usuario || {nome:'Administrador'},
      msg: req.session.msg||[], erro: req.session.erro||[]
    });
    delete req.session.msg; delete req.session.erro;
  } catch(e) { res.status(500).send('Erro: '+e.message); }
});

router.post('/assistente-virtual/aprender', requireAuth, async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) return res.json({ erro: 'Mensagem vazia' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ erro: 'API key nao configurada' });
    const _ax = require('axios');
    const prompt = 'Você é o assistente de treinamento do Lauro, atendente virtual da LAURO Liga Acadêmica de Urologia. O administrador vai te ensinar informações (texto, imagens ou documentos). Extraia os pontos principais e crie perguntas/respostas úteis para uso no WhatsApp. RESPONDA APENAS EM JSON puro (sem markdown, sem backticks): {"mensagem":"Confirmação amigável do que aprendeu (1-2 frases, use emojis)","aprendizados":[{"pergunta":"Pergunta específica que um membro faria no WhatsApp","resposta":"Resposta completa e útil"}]}. Crie entre 1 e 4 pares. Seja específico — inclua nomes, datas, links quando disponíveis.';
    const { arquivo } = req.body;
    let msgContent;
    if (arquivo) {
      const isImage = arquivo.tipo.startsWith('image/');
      const isPDF = arquivo.tipo === 'application/pdf';
      if (isImage) {
        msgContent = [
          { type: 'image', source: { type: 'base64', media_type: arquivo.tipo, data: arquivo.base64 } },
          { type: 'text', text: mensagem || 'Analise esta imagem e extraia todas as informações relevantes para a base de conhecimento da Liga.' }
        ];
      } else if (isPDF) {
        msgContent = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivo.base64 } },
          { type: 'text', text: mensagem || 'Analise este documento e extraia as informações relevantes para a base de conhecimento da Liga.' }
        ];
      } else {
        const textoArquivo = Buffer.from(arquivo.base64, 'base64').toString('utf-8');
        msgContent = mensagem + '\n\nConteúdo do arquivo ' + arquivo.nome + ':\n' + textoArquivo.substring(0,4000);
      }
    } else {
      msgContent = mensagem;
    }
    const apiRes = await _ax.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6', max_tokens: 1500,
      system: prompt, messages: [{ role: 'user', content: msgContent }]
    }, { headers: { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' } });
    const text = apiRes.data.content && apiRes.data.content[0] ? apiRes.data.content[0].text : '{}';
    // Registrar uso de tokens (claude-sonnet-4-6: $0.003/1k entrada, $0.015/1k saida)
    try {
      const uso = apiRes.data.usage || {};
      const tIn = uso.input_tokens || 0;
      const tOut = uso.output_tokens || 0;
      const custo = (tIn * 0.003 / 1000) + (tOut * 0.015 / 1000);
      await query('INSERT INTO anthropic_uso (contexto,modelo,tokens_entrada,tokens_saida,custo_estimado) VALUES ($1,$2,$3,$4,$5)',
        ['assistente-virtual', 'claude-sonnet-4-6', tIn, tOut, custo]);
    } catch(e) {}
    const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
    const ids = [];
    for (const ap of (parsed.aprendizados||[])) {
      const r2 = await query('INSERT INTO lauro_conhecimento (pergunta, resposta, ativo) VALUES ($1,$2,1) RETURNING id',
        [ap.pergunta.substring(0,500), ap.resposta.substring(0,2000)]);
      ids.push(r2.rows[0].id);
    }
    const apComIds = (parsed.aprendizados||[]).map((ap,i)=>({...ap, id:ids[i]}));
    res.json({ resposta: parsed.mensagem, aprendizados: apComIds, total: ids.length });
  } catch(e) { console.error('AV aprender:', e.message); res.json({ erro: 'Erro: '+e.message }); }
});


router.post('/assistente-virtual/conhecimento/:id/editar', requireAuth, async (req,res) => {
  try {
    const { pergunta, resposta } = req.body;
    if (!pergunta || !resposta) return res.json({ok:false, erro:'Campos vazios'});
    await query('UPDATE lauro_conhecimento SET pergunta=$1, resposta=$2 WHERE id=$3',
      [pergunta.substring(0,500), resposta.substring(0,2000), req.params.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false}); }
});

router.post('/assistente-virtual/conhecimento/:id/toggle', requireAuth, async (req,res) => {
  try { await query('UPDATE lauro_conhecimento SET ativo=CASE WHEN ativo=1 THEN 0 ELSE 1 END WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.json({ok:false}); }
});

router.post('/assistente-virtual/conhecimento/:id/deletar', requireAuth, async (req,res) => {
  try { await query('DELETE FROM lauro_conhecimento WHERE id=$1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.json({ok:false}); }
});

};
