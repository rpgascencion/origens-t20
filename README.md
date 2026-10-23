# Origens Automáticas (T20)

Módulo para Foundry v13 + sistema Tormenta20.

## Compêndio
Na barra lateral, na pasta **Origens**, fica o compêndio **Origens** com uma pasta por livro:
- **Livro Básico** (35 origens, p. 85-95)
- **Heróis de Arton** (30 origens especiais, p. 46-53)
- **Atlas de Arton** (66 origens regionais, p. 470-479)

## Como funciona
- **Livro Básico:** ao arrastar a origem para a ficha, abre uma caixa para escolher exatamente 2 benefícios. Perícia escolhida fica treinada; poder escolhido é adicionado à ficha. Origens com "um poder de combate/da Tormenta à sua escolha" abrem uma lista; "Ofício" abre a lista de ofícios. Amnésico abre a caixa para o mestre escolher a perícia e o poder, e adiciona Lembranças Graduais sozinho.
- **Heróis de Arton e Atlas de Arton:** têm um benefício único, então o poder da origem é adicionado direto, sem caixa (os efeitos de perícia treinada e bônus já vêm configurados no poder).
- Em todos os casos o campo "Origem" da ficha é preenchido com o nome da origem.

## Requisitos
- Poderes do Livro Básico: vêm do próprio sistema Tormenta20.
- Heróis de Arton e Atlas de Arton: usam os poderes do módulo **Suplementos de Arton** (precisa estar ativo). A exceção é Desertor da Supremacia, cujo poder está neste módulo.

## Observações
- Itens de origem aparecem no texto, mas não são adicionados à ficha.
- Quando o benefício dá treino em perícia que o personagem já tem, a regra manda treinar outra perícia de classe; isso é manual nas origens de Heróis e do Atlas.

## v0.2.0
- Origens com escolha extra agora abrem uma caixa: Aspirante a herói (+1 em um atributo, somado direto no atributo), Cosmopolita, Futura Lenda, Estandarte Vivo, Menestrel, Estudante da Academia, De Outro Mundo, Duplo Feérico, Citadino Abastado (Ofício) e Espião (perícia com Carisma).
- Visual do kit Tormenta20 (papel, faixa vermelha, botões vinho), igual ao Assistente de Ficha.


## v0.2.3
- O campo **Subtipo** de cada origem agora é o **nome da própria origem** (antes era o livro ou a região), igual aos poderes de origem do sistema. Assim o Assistente de Criação do T20 Hayd GMTools lista cada origem pelo nome e mostra a origem certa em "Poderes de <origem>", em vez de "Livro Básico", "Heróis de Arton" etc.
- No GMTools, ligue o compêndio *Origens* em *Fontes do Assistente de Criação*. Ao concluir a criação, as origens arrastadas abrem a caixa de escolha do módulo normalmente.
