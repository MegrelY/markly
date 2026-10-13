interface User { id: number; name?: string }
export const greet = (u: User): string => { return `hi ${u.name ?? "there"}` }
