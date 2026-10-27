import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { tr } from "../../lib/app-language"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon role="status" aria-label={tr("加载中", "Loading", "불러오는 중")} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
