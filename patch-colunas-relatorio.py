#!/usr/bin/env python3
# Troca o seletor de colunas (select multiple escondido) por checkboxes VISÍVEIS e claros
# na tela de relatório de ligantes.

f = '/var/www/liga-urologia/views/pages/ligantes-relatorio.ejs'
src = open(f).read()

# Bloco antigo: o campo escondido com o <select multiple>
ini = src.find('<div class="campo" style="display:none">\n              <label class="label">Colunas a exibir</label>')
fim_marker = '</select>\n            </div>'
fim = src.find(fim_marker, ini)

if ini == -1 or fim == -1:
    print("AVISO: bloco do seletor de colunas não localizado")
    raise SystemExit

bloco_antigo = src[ini:fim + len(fim_marker)]

# Lista de colunas disponíveis (valor, rótulo) — todas as opções que existiam
colunas = [
    ('nome', 'Nome'),
    ('email', 'E-mail'),
    ('whatsapp', 'WhatsApp'),
    ('sexo', 'Sexo'),
    ('data_nascimento', 'Nascimento'),
    ('semestre', 'Semestre'),
    ('turma', 'Turma'),
    ('catraca', 'Catraca'),
    ('rg', 'RG/CI'),
    ('cpf', 'CPF'),
    ('status', 'Status'),
    ('criado_em', 'Data cadastro'),
]

# Monta os checkboxes
checks = ''
for val, lab in colunas:
    checks += (
        '                <label class="col-check">'
        '<input type="checkbox" name="colunas" value="' + val + '" '
        '<%= (filtros.colunas||[]).includes(\'' + val + '\')?\'checked\':\'\' %> '
        'onchange="this.form.submit()"> ' + lab + '</label>\n'
    )

bloco_novo = '''<div class="campo" style="grid-column:1/-1">
              <label class="label" style="margin-bottom:8px;display:block">Colunas a exibir no relatório <span style="font-weight:400;color:var(--texto2);font-size:12px">(marque só o que precisar — protege dados sensíveis)</span></label>
              <div class="col-checks">
''' + checks + '''              </div>
              <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn-mini" onclick="presetColunas(['nome','email'])">Apenas Nome + E-mail</button>
                <button type="button" class="btn-mini" onclick="presetColunas(['nome','whatsapp'])">Apenas Nome + WhatsApp</button>
                <button type="button" class="btn-mini" onclick="presetColunas(['nome','email','whatsapp','semestre','turma','status'])">Padrão</button>
              </div>
            </div>'''

src = src.replace(bloco_antigo, bloco_novo)

# Adicionar CSS dos checkboxes e botões-mini (logo após a regra do #sel-colunas, que vamos manter inofensiva)
css_add = '''    #sel-colunas { height:130px;border-radius:8px; }
    .col-checks { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px 16px;padding:14px;border:1.5px solid var(--borda);border-radius:10px;background:var(--fundo); }
    .col-check { display:flex;align-items:center;gap:7px;font-size:13px;font-weight:500;color:var(--texto);cursor:pointer;white-space:nowrap; }
    .col-check input { width:16px;height:16px;cursor:pointer;accent-color:var(--cor-primaria); }
    .btn-mini { font-size:12px;font-weight:600;padding:6px 12px;border:1.5px solid var(--cor-primaria);background:transparent;color:var(--cor-primaria);border-radius:7px;cursor:pointer;transition:all .15s; }
    .btn-mini:hover { background:var(--cor-primaria);color:#fff; }'''
src = src.replace('    #sel-colunas { height:130px;border-radius:8px; }', css_add, 1)

# Adicionar a função JS presetColunas antes de </body> (ou no fim, dentro de um <script>)
js_add = '''<script>
function presetColunas(lista){
  document.querySelectorAll('input[name="colunas"]').forEach(function(cb){
    cb.checked = lista.includes(cb.value);
  });
  // submete o form mantendo os demais filtros
  var form = document.getElementById('form-filtros');
  if (form) form.submit();
}
</script>
'''
if '</body>' in src:
    src = src.replace('</body>', js_add + '</body>', 1)
else:
    src = src + '\n' + js_add

open(f, 'w').write(src)
print("OK: seletor de colunas trocado por checkboxes visíveis + presets (Nome+E-mail, etc)")
