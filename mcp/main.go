package main

import (
	"fmt"
	"os"
)

func main() {
	if err := newServer().serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
