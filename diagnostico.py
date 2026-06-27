filepath = '/var/www/liga-urologia/src/routes/index.js'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i, line in enumerate(lines):
    if 'contratos' in line and 'pdf' in line.lower():
        print(f"ROTA linha {i+1}: {line.rstrip()}")
        for j in range(i, min(i+120, len(lines))):
            print(f"{j+1:4d}: {lines[j]}", end='')
        break
