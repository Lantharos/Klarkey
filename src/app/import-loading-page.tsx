export function ImportLoadingPage({
  message,
  submessage,
  status = 'info',
}: {
  message: string
  submessage?: string
  status?: 'success' | 'error' | 'locked' | 'info'
}) {
  const isSettled = status === 'success' || status === 'error'
  const markerClass = status === 'error'
    ? 'bg-red-300/90'
    : status === 'success'
      ? 'bg-emerald-300/90'
      : 'bg-white/60'

  return (
    <div className="flex h-full min-h-full flex-col items-center justify-center gap-4 px-6 text-white">
      <div className="flex flex-col items-center gap-3">
        <div className="text-[15px] font-medium text-white/90">{message}</div>
        {submessage ? <div className="text-[13px] text-white/50">{submessage}</div> : null}
        <div className="mt-1 h-[2px] w-40 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${isSettled ? 'w-full' : 'w-1/3 animate-[slide_1.5s_ease-in-out_infinite]'} ${markerClass}`}
            style={{
              animation: isSettled ? undefined : 'slide 1.5s ease-in-out infinite',
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  )
}
