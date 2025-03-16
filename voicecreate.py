import discord
from discord.ext import commands
import traceback
import os 
import sys

token = os.getenv('TOKEN')

bot = commands.Bot(command_prefix=">")

bot.remove_command("help")


if token is None:
    raise ValueError("Error [TokenInvalid]: An invalid token was provided")

initial_extensions = ['cogs.voice']

if __name__ == '__main__':
    for extension in initial_extensions:
        try:
            bot.load_extension(extension)
        except Exception as e:
            print(f'Failed to load extension {extension}.', file=sys.stderr)
            traceback.print_exc()

@bot.event
async def on_ready():
    await bot.change_presence(activity=discord.Game(name=">help and >voice setup"))
    print(bot.user.name, "Connected.")
    print("User ID: ", bot.user.id)
    print('-------------------------------------')

bot.run(token)

