// EXAMPLE — the slot convention: `<k>.slot.tsx` default-exports { slot, component, order }.
// The slot name is declared by the page that renders it (here: app/(app)/example/page.tsx).
function HelloSlot() {
  return <p data-testid="hello-slot">Rendered by a *.slot.tsx file</p>;
}

export default { slot: "example.hello.extras", component: HelloSlot, order: 10 };
