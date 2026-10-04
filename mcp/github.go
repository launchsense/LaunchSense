package main

import (
	"fmt"
	"strings"

	"github.com/cli/go-gh/v2/pkg/api"
	"github.com/cli/go-gh/v2/pkg/auth"
	"github.com/cli/go-gh/v2/pkg/repository"
)

// Account is what we may say about the local gh login.
// It never includes a token.
type Account struct {
	LoggedIn bool
	Login    string
	Owner    string
	Name     string
	Private  bool
	Host     string
}

func (a Account) Repo() string {
	if a.Owner == "" || a.Name == "" {
		return ""
	}
	return a.Owner + "/" + a.Name
}

func (a Account) URL() string {
	host := a.Host
	if host == "" || host == "github.com" {
		return "https://github.com/" + a.Repo()
	}
	return "https://" + host + "/" + a.Repo()
}

func localAccount() (Account, error) {
	token, _ := auth.TokenForHost("github.com")
	if strings.TrimSpace(token) == "" {
		return Account{}, nil
	}
	client, err := api.DefaultRESTClient()
	if err != nil {
		return Account{}, err
	}
	var user struct {
		Login string `json:"login"`
	}
	if err := client.Get("user", &user); err != nil {
		return Account{}, err
	}
	account := Account{LoggedIn: true, Login: user.Login, Host: "github.com"}
	repo, err := repository.Current()
	if err != nil {
		return account, nil
	}
	account.Host = repo.Host
	account.Owner = repo.Owner
	account.Name = repo.Name
	var meta struct {
		Private bool `json:"private"`
	}
	path := fmt.Sprintf("repos/%s/%s", repo.Owner, repo.Name)
	if err := client.Get(path, &meta); err != nil {
		return account, nil
	}
	account.Private = meta.Private
	return account, nil
}

func lookupRepo(owner, name string) (private bool, err error) {
	client, err := api.DefaultRESTClient()
	if err != nil {
		return false, err
	}
	var meta struct {
		Private bool `json:"private"`
	}
	err = client.Get(fmt.Sprintf("repos/%s/%s", owner, name), &meta)
	return meta.Private, err
}
