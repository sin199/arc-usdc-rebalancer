export type ActivityTone = 'neutral' | 'success' | 'warning'

export type ActivityEntry = {
  id: string
  title: string
  detail: string
  createdAt: string
  tone: ActivityTone
}
