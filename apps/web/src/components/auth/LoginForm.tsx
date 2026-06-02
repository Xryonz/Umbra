import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { LoginSchema, type LoginInput } from '@umbra/types'

const editorialInputClass =
  'h-11 rounded-none border-0 border-b border-(--border-mid) bg-transparent px-0 py-2 text-[15px] ' +
  'placeholder:italic placeholder:text-(--text-3) ' +
  'focus-visible:ring-0 focus-visible:border-(--accent) focus-visible:shadow-[0_1px_0_0_var(--accent)] ' +
  'transition-colors duration-300 ease-(--ease-spring)'

const editorialLabelClass = 'ed-label mb-1'

export default function LoginForm() {
  const { login } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (data: LoginInput) => {
    setServerError(null)
    try {
      await login(data)
    } catch (err: any) {
      setServerError(err.response?.data?.error ?? 'Erro ao fazer login')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={editorialLabelClass}>E-mail</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="voce@exemplo.com"
                  autoComplete="email"
                  className={editorialInputClass}
                  {...field}
                />
              </FormControl>
              <FormMessage className="ed-marg text-(--danger)! mt-1" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={editorialLabelClass}>Senha</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={editorialInputClass}
                  {...field}
                />
              </FormControl>
              <FormMessage className="ed-marg text-(--danger)! mt-1" />
            </FormItem>
          )}
        />

        {serverError && (
          <div className="u-error" role="alert">{serverError}</div>
        )}

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="
            mt-2 h-12 w-full rounded-lg
            bg-(--accent) text-(--text-inv)
            font-medium tracking-wider uppercase text-xs
            hover:bg-(--accent-h) hover:shadow-[0_8px_24px_var(--accent-glow)]
            transition-all duration-300 ease-(--ease-spring)
          "
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Entrando...
            </>
          ) : 'Entrar'}
        </Button>
      </form>
    </Form>
  )
}
