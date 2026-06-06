/**
 * Slash commands — transformações client-side aplicadas no `content` antes de mandar.
 * Retorna o content transformado ou null se não for command/sem match.
 */

interface SlashCommand {
  name: string
  description: string
  transform: (args: string) => string
}

const COMMANDS: SlashCommand[] = [
  {
    name:        'me',
    description: '/me ação — narração em terceira pessoa',
    transform:   (args) => args.trim() ? `*${args.trim()}*` : '',
  },
  {
    name:        'shrug',
    description: '/shrug — ¯\\_(ツ)_/¯',
    transform:   (args) => `¯\\_(ツ)_/¯${args ? ' ' + args.trim() : ''}`,
  },
  {
    name:        'tableflip',
    description: '/tableflip — (╯°□°)╯︵ ┻━┻',
    transform:   (args) => `(╯°□°)╯︵ ┻━┻${args ? ' ' + args.trim() : ''}`,
  },
  {
    name:        'unflip',
    description: '/unflip — ┬─┬ ノ( ゜-゜ノ)',
    transform:   (args) => `┬─┬ ノ( ゜-゜ノ)${args ? ' ' + args.trim() : ''}`,
  },
  {
    name:        'flip',
    description: '/flip — (ノಠ益ಠ)ノ彡┻━┻',
    transform:   (args) => `(ノಠ益ಠ)ノ彡┻━┻${args ? ' ' + args.trim() : ''}`,
  },
  {
    name:        'spoiler',
    description: '/spoiler texto — esconde o texto',
    transform:   (args) => args.trim() ? `||${args.trim()}||` : '',
  },
]

const COMMANDS_MAP = new Map(COMMANDS.map((c) => [c.name, c]))

export function listSlashCommands(): ReadonlyArray<SlashCommand> {
  return COMMANDS
}

/**
 * Se `text` for um slash command suportado, retorna o resultado transformado.
 * Senão retorna null (caller manda o texto raw).
 * `/astra` (e legado `/umbra`) é tratado em outro lugar (bot) — não conflita.
 */
export function applySlashCommand(text: string): string | null {
  const m = text.match(/^\/([a-z]+)(?:\s+(.*))?$/i)
  if (!m) return null
  const [, name, args = ''] = m
  const cmd = COMMANDS_MAP.get(name.toLowerCase())
  if (!cmd) return null
  return cmd.transform(args)
}
