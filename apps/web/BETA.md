# Astra — Guia do Beta Tester

Guia pra rodada de testes com amigos. A mensagem pronta pra colar no
WhatsApp está no fim do arquivo.

---

## Instalação (Android)

1. Recebeu o arquivo `astra.apk` → toque nele
2. O Android vai avisar sobre "fonte desconhecida" → **Permitir desta fonte**
3. Instalar → abrir → criar conta (ou entrar com Google)

> iPhone: ainda não — Android only por enquanto.

## O que testar (e o que esperamos que funcione)

### Básico
- [ ] Criar conta / login com Google
- [ ] Entrar numa constelação por convite
- [ ] Mandar mensagem, emoji, GIF, foto da galeria
- [ ] **Câmera**: botão "+" no chat → Câmera → foto vai direto

### Gestos (novidade)
- [ ] Arrastar mensagem **pra direita** → responde
- [ ] Arrastar a tela **pra esquerda** → abre a gaveta de constelações
- [ ] **Segurar o microfone** → grava áudio · soltar → envia · arrastar pro lado → cancela

### Chamadas
- [ ] Call de voz com outra pessoa — qualidade do áudio?
- [ ] **Sair do app durante a call** (botão home) → o áudio deve CONTINUAR
      e aparecer a notificação "Em chamada"
- [ ] Call de vídeo → sair do app → vira janelinha flutuante (PiP)

### Teclado e fluidez
- [ ] Digitar várias mensagens — o teclado abre liso? O campo fica colado nele?
- [ ] Geral: alguma tela travando, botão pequeno demais, texto cortado?

### Offline
- [ ] Abrir o app no modo avião → as conversas recentes aparecem?

## Como reportar um problema

Manda no grupo (ou direto) nesse formato:

```
📱 Celular: (ex: Galaxy S21, Android 14)
🐛 O que aconteceu: (ex: o áudio parou quando travei a tela)
🔁 Como repetir: (ex: entrar em call → apertar power)
```

Print ou gravação de tela ajuda MUITO (segurar power+volume- grava em
vários Androids).

## Limitações conhecidas (não precisa reportar)

- Notificação com o app fechado pode não chegar ainda (FCM em ativação)
- iPhone não tem
- O app pode pedir permissão de mic/câmera de novo em alguns aparelhos

---

## Mensagem pronta pro WhatsApp

> Oi! Tô desenvolvendo um app de conversa chamado **Astra** (tipo Discord,
> mas do meu jeito) e preciso de cobaias 🧪
>
> É só instalar o APK que vou mandar (Android), criar conta e usar normal
> por uns dias. O que eu mais quero saber:
> • travou? onde?
> • chamada de voz funcionou? e saindo do app no meio?
> • segura o microfone pra gravar áudio — curtiu o jeito?
>
> Qualquer coisa estranha, manda print aqui. Valeu! 🌌
