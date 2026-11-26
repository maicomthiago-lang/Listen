# Listen

Protótipo local para reconhecer a música captada pelo microfone, revisar título e artista, e criar uma pasta de organização após confirmação.

## Executar

1. Instale Python 3.10 ou mais recente.
2. No terminal, nesta pasta: `python -m pip install -r requirements.txt`
3. Crie uma conta/token de API em [AudD](https://audd.io/). Configure `AUDD_API_TOKEN` como variável de ambiente antes de iniciar.
   - PowerShell: `$env:AUDD_API_TOKEN="seu-token"`
4. Inicie: `python server.py`
5. Abra `http://127.0.0.1:8000` em um navegador com suporte a `getUserMedia` e File System Access API (por exemplo, Chrome ou Edge). Autorize o microfone.

## Publicar na Vercel

O projeto usa Flask e a Vercel reconhece a aplicação exportada como `app` em `server.py`. Para publicar via Git, envie este repositório a GitHub, GitLab ou Bitbucket e importe-o em [vercel.com/new](https://vercel.com/new). Também é possível instalar a Vercel CLI e executar `vercel` para um preview ou `vercel --prod` para produção. Cadastre `AUDD_API_TOKEN` em **Project Settings → Environment Variables** antes de usar o reconhecimento publicado. Não inclua o token nos arquivos do projeto.

Na Vercel, a captura exige HTTPS e permissão do microfone. A criação de pastas no dispositivo do usuário depende da File System Access API do navegador.

O modo sob demanda grava um trecho de 8 segundos quando se clica em **Ouvir agora**. Escuta contínua repete a captura enquanto a aba fica aberta. A amostra é enviada ao AudD para reconhecimento; configure e consulte os limites/preços do serviço antes de uso frequente. O token permanece no servidor.

## Salvar e obter mídia

Depois de identificar a faixa, **Salvar em uma pasta…** solicita a confirmação da pasta e só então a cria no diretório escolhido. O campo de link é para uma fonte oficial que autorize o download. O protótipo abre esse link no navegador; não baixa nem converte conteúdo de serviços de streaming. A qualidade 720p–4K é uma preferência para orientar a busca, pois a disponibilidade depende da fonte escolhida. Para arquivos próprios, licenciados ou de domínio público, a próxima etapa de produto é integrar uma fonte de download autorizada que exponha formatos e resoluções reais.

## Pesquisa e decisão técnica

- **AudD**: documenta identificação a partir de gravações de microfone/arquivos e retorna metadados da música. A integração atual usa o endpoint de reconhecimento de arquivo no servidor.
- **ACRCloud**: oferece identificação por impressão digital de áudio com API autenticada; é uma alternativa para avaliar em um piloto comparativo.
- Reconhecimento não concede direitos de download. Os termos do YouTube permitem baixar conteúdo nos casos autorizados pelo próprio serviço ou com permissão dos titulares. Por isso, o app organiza a faixa após confirmação, mas direciona a uma origem oficial e não extrai áudio/vídeo de plataformas.

Fontes consultadas (26/11/2026): [documentação AudD](https://docs.audd.io/), [API de identificação ACRCloud](https://docs.acrcloud.com/reference/identification-api/identification-api), [termos do YouTube](https://youtube.com/t/terms).

## Limites atuais

- Microfone capta o ambiente; capturar diretamente o áudio interno do sistema depende do navegador/OS e não está implementado.
- Reconhecimento requer token e conexão com o AudD.
- A criação de pastas usa a File System Access API, disponível em navegadores compatíveis.
- O modo contínuo mantém o microfone ativo com permissão explícita enquanto a página fica aberta.
