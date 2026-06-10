# Astra Mobile (Capacitor)

Guia pra empacotar Astra como app nativo Android/iOS via Capacitor 7.

> **Status**: Android já configurado (pasta `android/` gerada). iOS pendente — precisa de Mac com Xcode.

---

## Pré-requisitos

| Plataforma | Toolchain |
|---|---|
| **Android** | **JDK 21** (Temurin), Android SDK (cmdline-tools ou Android Studio) |
| **iOS** | macOS + Xcode 15+, CocoaPods (`brew install cocoapods`) |

> **JDK 21, não 17**: Capacitor 7 compila com `sourceCompatibility VERSION_21`
> (ver `android/app/capacitor.build.gradle`). JDK 17 falha com
> `error: invalid source release: 21`.

**Setup desta máquina (já feito):**
- JDK 21 Temurin via winget → apontado em `android/gradle.properties`
  (`org.gradle.java.home`), sem mexer no JAVA_HOME global
- Android SDK via cmdline-tools em `%LOCALAPPDATA%\Android\Sdk`
  (platform-tools + android-35 + build-tools 35) → `android/local.properties`
- `android.overridePathCheck=true` no gradle.properties porque o path do
  repo tem acento ("Códigos") e o AGP bloqueia non-ASCII no Windows

---

## Fluxo de build

```bash
cd apps/web

# 1. Build web (gera dist/)
npm run build

# 2. Sync: copia dist/ pros projetos nativos e propaga plugins
npx cap sync

# 3a. Android — abre Android Studio
npx cap open android

# 3b. iOS — abre Xcode (precisa Mac)
npx cap open ios
```

Shortcut combinado:
```bash
npm run build:mobile   # build + cap copy
```

---

## Adicionar iOS (Mac only)

iOS ainda não foi adicionado porque desenvolvimento é Windows. Quando rodar em Mac:

```bash
cd apps/web
npx cap add ios
cd ios/App && pod install && cd ../..
npx cap sync ios
npx cap open ios
```

Depois, em Xcode:
1. Selecionar **Team** (Apple Developer account)
2. Trocar **Bundle Identifier** se `app.astra.client` estiver em uso
3. Configurar **Signing & Capabilities**
4. Build → Run em simulador ou device

---

## Plugins recomendados (instalar sob demanda)

```bash
npm i @capacitor/push-notifications -w @astra/web
npm i @capacitor/status-bar         -w @astra/web
npm i @capacitor/keyboard           -w @astra/web
npx cap sync
```

| Plugin | Por quê |
|---|---|
| `@capacitor/push-notifications` | FCM (Android) + APNs (iOS) nativos. Web push (VAPID) é instável em mobile, especialmente iOS Safari WebView. Plugin nativo é o caminho oficial. |
| `@capacitor/status-bar` | Cor da status bar segue o tema obsidian (`#06060e`). Sem isso, fica branco no iOS. |
| `@capacitor/keyboard` | Ajuste de viewport quando teclado abre — sem isso, input de mensagem some debaixo do teclado em iOS. |

### Setup push notifications

1. **Android**: criar projeto Firebase, baixar `google-services.json`, colocar em `android/app/`
2. **iOS**: habilitar push em Apple Developer (APN key) + configurar Push Notifications capability em Xcode
3. Servidor: enviar via FCM/APNs (não VAPID nativo)

> Trade-off: push nativo requer 2 backends paralelos (FCM + VAPID). Pra simplicidade, considerar manter só web push até user base justificar.

---

## Atalhos úteis

```bash
# Sincronizar deps nativas após mudar package.json
npx cap sync

# Live reload em dev (descomente server.url no capacitor.config.ts)
# - útil pra ver mudanças sem rebuildar
# - aponta pra IP local: http://192.168.0.X:5173
# - cleartext: true (HTTP em dev)

# Trocar splash/ícone:
# Use https://capacitorjs.com/docs/guides/splash-screens-and-icons
# ou ferramenta @capacitor/assets:
npx @capacitor/assets generate --iconBackgroundColor '#06060e' --splashBackgroundColor '#06060e'
```

---

## Instalar no celular (sem Android Studio)

```bash
# 1. Compilar
cd apps/web/android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk (~9MB)

# 2a. Via USB (depuração USB ligada no celular):
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb install app/build/outputs/apk/debug/app-debug.apk

# 2b. Sem cabo: mandar o .apk pro celular (Drive/WhatsApp/etc),
#     tocar no arquivo e aceitar "instalar de fonte desconhecida".
```

## Problemas conhecidos

| Problema | Solução |
|---|---|
| `Unable to launch Android Studio` | `npx cap open android` precisa Android Studio instalado **OU** seta `CAPACITOR_ANDROID_STUDIO_PATH` env var. Sem Studio, buildar via `cd android && ./gradlew assembleDebug`. |
| `error: invalid source release: 21` | Capacitor 7 exige JDK 21. Instalar Temurin 21 e apontar `org.gradle.java.home` no `android/gradle.properties`. |
| `Your project path contains non-ASCII characters` | `android.overridePathCheck=true` no `android/gradle.properties` (já aplicado). |
| `SDK location not found` | Criar `android/local.properties` com `sdk.dir=C:/Users/<user>/AppData/Local/Android/Sdk`. |
| `WebSocket falha em iOS` | iOS WKWebView às vezes bloqueia WS sem TLS. Use `wss://` em prod (Railway já dá). |
| Push web (VAPID) não chega em iOS | iOS 16.4+ suporta web push, mas só pra PWAs instalados via "Add to Home Screen". Pra reliability, use plugin nativo. |

---

## Build de produção (futuro)

### Android (Play Store)
```bash
cd apps/web/android
./gradlew bundleRelease   # gera .aab pra upload
# .aab fica em app/build/outputs/bundle/release/
```
Precisa keystore (`./gradlew signingReport` mostra config).

### iOS (App Store)
Em Xcode: `Product → Archive`, depois `Distribute App` no Organizer.

---

## Referência

- Capacitor docs: https://capacitorjs.com/docs
- Android setup: https://capacitorjs.com/docs/getting-started/environment-setup
- iOS setup:     https://capacitorjs.com/docs/ios
