# Listen

Aplicação web local para reconhecer a música captada pelo microfone (ou enviada por arquivo de áudio), visualizar metadados completos (capa, álbum, data de lançamento, prévia e links oficiais) e organizar uma pasta com resumo da faixa após confirmação.

## Estrutura do projeto

- `server.py` — servidor Flask que serve a interface, expõe `/api/status` e faz proxy autenticado para o AudD em `/api/recognize` (mantendo o token fora do navegador).
- `index.html` — estrutura HTML semântica da interface.
- `static/styles.css` — estilos responsivos e tema escuro.
- `static/app.js` — captura de áudio com visualizador de nível, downsampling para WAV 16 kHz, detecção de silêncio, upload de arquivo, histórico persistente em `localStorage` e organização de pastas.
- `tests/test_server.py` — testes unitários do backend.
- `.env.example` — exemplo de variáveis de ambiente locais.

## Executar localmente

1. Instale Python 3.10 ou mais recente.
2. No terminal, nesta pasta: `python -m pip install -r requirements.txt` (ou `py -m pip install -r requirements.txt` no Windows).
3. Configure o token do AudD:
   - Copie `.env.example` para `.env` e ajuste `AUDD_API_TOKEN`, **ou**
   - Defina a variável de ambiente no terminal: `$env:AUDD_API_TOKEN="test"` (PowerShell).
   - O token público `test` é compartilhado e limitado a 10 chamadas por dia (apenas demonstração). Para uso próprio, crie uma conta em [AudD](https://audd.io/).
4. Inicie o servidor: `python server.py` (ou `py server.py`).
5. Abra `http://127.0.0.1:8000` em um navegador moderno (Chrome ou Edge para suporte completo à File System Access API; outros navegadores usam download automático de resumo `.txt` como fallback).

## Executar testes

```bash
python -m unittest discover -s tests -v
```
*(No Windows com PyManager: `py -m unittest discover -s tests -v`)*

## Recursos implementados

- **Captura sob demanda (8s) e escuta contínua** com visualizador de nível de áudio em tempo real, contagem regressiva, botão de cancelamento e atalho na tecla `Espaço`.
- **Otimização de áudio**: downsampling para WAV mono 16 kHz e detecção de silêncio para evitar chamadas desnecessárias à API.
- **Upload de arquivo de áudio**: identifique faixas a partir de arquivos locais (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.webm`, até 10 MB).
- **Metadados ricos**: capa do álbum, data de lançamento, player de prévia (quando fornecido pelo provedor) e links diretos para Spotify, Apple Music, página da faixa e busca oficial.
- **Histórico persistente**: salvo em `localStorage`, clicável para reabrir resultados anteriores, com deduplicação consecutiva na escuta contínua e opção de limpar.
- **Organização segura**: cria a pasta após confirmação do usuário e opcionalmente gera `detalhes.txt` com metadados e links; em navegadores sem File System Access API, oferece download do resumo `.txt`.

## Publicar na Vercel

O projeto usa Flask e exporta `app` em `server.py`. Para publicar via Git, envie o repositório ao GitHub, GitLab ou Bitbucket e importe-o em [vercel.com/new](https://vercel.com/new). Cadastre `AUDD_API_TOKEN` em **Project Settings → Environment Variables** antes de usar o reconhecimento publicado. Não inclua o token nem o arquivo `.env` no repositório.

Na Vercel, a captura de microfone exige HTTPS e permissão explícita do usuário.

## Salvar e obter mídia

Depois de identificar a faixa, **Salvar em uma pasta…** solicita a confirmação da pasta e só então a cria no diretório escolhido. O campo de link é para uma fonte oficial que autorize o download. O aplicativo apenas abre esse link no navegador; não baixa nem converte conteúdo de serviços de streaming. A qualidade 720p–4K é uma preferência registrada no resumo para orientar a busca.

## Limites atuais

- O microfone capta o áudio ambiente; capturar diretamente o áudio interno do sistema depende do navegador/SO e não está implementado.
- O reconhecimento requer token válido e conexão com o AudD.
- A criação direta de pastas depende da File System Access API; navegadores sem suporte fazem fallback para download de `detalhes.txt`.
