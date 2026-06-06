import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { RegisterSchema, type RegisterInput } from '@astra/types'

export default function RegisterForm() {
  const { register: registerUser } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()

  // Pré-preencher email + lock se veio do flow "Google → email não registrado"
  const prefilledEmail = searchParams.get('email') ?? ''
  const fromGoogle     = searchParams.get('from') === 'google'

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { displayName: '', username: '', email: prefilledEmail, password: '' },
  })

  const onSubmit = async (data: RegisterInput) => {
    setServerError(null)
    try {
      await registerUser(data)
    } catch (err: any) {
      setServerError(err.response?.data?.error ?? 'Erro ao criar conta')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome de exibição</FormLabel>
              <FormControl>
                <Input placeholder="Como você quer ser chamado" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="meu_usuario" autoComplete="username" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                E-mail
                {fromGoogle && (
                  <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-(--accent)">
                    · vindo do Google
                  </span>
                )}
              </FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="voce@exemplo.com"
                  autoComplete="email"
                  readOnly={fromGoogle}
                  className={fromGoogle ? 'opacity-80 cursor-not-allowed' : undefined}
                  {...field}
                />
              </FormControl>
              {fromGoogle && (
                <p className="text-marg text-(--text-3) m-0 mt-1 italic">
                  Email preenchido pelo Google. Vai poder logar com Google após criar a conta.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl>
                <Input type="password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverError && <div className="u-error" role="alert">{serverError}</div>}

        <Button type="submit" className="mt-2 w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Criando conta...
            </>
          ) : 'Criar conta'}
        </Button>
      </form>
    </Form>
  )
}
