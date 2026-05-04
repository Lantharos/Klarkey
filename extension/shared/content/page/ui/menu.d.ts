export function appendFieldMenuButton(input: {
  container: HTMLElement
  title: string
  secondary?: string
  onClick: (event: Event) => void | Promise<void>
}): void
