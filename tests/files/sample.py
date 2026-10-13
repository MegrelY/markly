"""Tiny inventory helper used to test Markly's code view."""
from dataclasses import dataclass


@dataclass
class Item:
    name: str
    qty: int = 0

    def total(self, price: float) -> float:
        # A comment with <html> & "quotes"
        return self.qty * price


def main():
    items = [Item("apple", 3), Item("pear", 5)]
    for it in items:
        print(f"{it.name}: {it.total(1.25):.2f}")


if __name__ == "__main__":
    main()
