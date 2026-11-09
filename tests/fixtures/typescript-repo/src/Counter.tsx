export function Counter({ total }: { total: number }) {
  return <span>{total}</span>;
}

export const example = <Counter total="wrong" />;
