terraform {
  required_version = ">= 1.4.0"
}

resource "terraform_data" "smoke" {
  input = "terrakube-action-smoke"
}

output "smoke" {
  value = terraform_data.smoke.output
}
