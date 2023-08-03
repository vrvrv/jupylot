import axios from 'axios';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel, Notebook } from '@jupyterlab/notebook';
import { OutputArea, OutputAreaModel } from '@jupyterlab/outputarea';
import { ICodeCellModel, CodeCell } from '@jupyterlab/cells';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';
import { ToolbarButton } from '@jupyterlab/apputils';
import { Dialog, showDialog } from '@jupyterlab/apputils';

/**
 * Initialization data for the error-button extension.
 */

interface Config {
  SECRET_KEY: string;
  LANGUAGE: string;
  PROMPT: string;
}

const Configuration: Config = {
  SECRET_KEY: '',
  LANGUAGE: 'KR',
  PROMPT: `
  파이썬 에러메시지 보고 에러의 이유를 요약해서 알려줘 (형식: 에러 이유: ~~ \n 해결 방법 : ~~)
  `
};


// 
class InputDialog extends Widget {
  constructor(secret_key: string, language: string, prompt: string) {
    super();
    this.addClass('myInputWidget');
    this.node.innerHTML = `
      <label>
        Secret Key: 
        <input id="secret_key" value="${secret_key}" />
      </label>
      <label>
        Language:
        <input id="language" value="${language}" />
      </label>
      <label>
        Prompt:
        <textarea id="prompt" rows="5" cols="50">${prompt}</textarea>
      </label>
    `;
  }

  getValue(): { secret_key: string; language: string, prompt: string} {
    return {
      secret_key: (this.node.querySelector('#secret_key') as HTMLInputElement).value,
      language: (this.node.querySelector('#language') as HTMLInputElement).value,
      prompt: (this.node.querySelector('#prompt') as HTMLInputElement).value
    };
  }
}

const extension: JupyterFrontEndPlugin<void> = {
  id: 'error-button',
  autoStart: true,
  requires: [INotebookTracker, IRenderMimeRegistry],
  activate: async (app: JupyterFrontEnd, notebooks: INotebookTracker, rendermime: IRenderMimeRegistry) => {
    console.log('JupyterLab extension error-button is activated!');

    notebooks.widgetAdded.connect((sender, notebookPanel) => {
      let myButton = new ToolbarButton({
          className: 'error-button-util',
          iconClass: 'fa fa-star', 
          onClick: async () => {
              let dialog = new InputDialog(Configuration.SECRET_KEY, Configuration.LANGUAGE, Configuration.PROMPT);
              let result = await showDialog({
                title: 'Config Error Button',
                body: dialog,
                buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'OK' })]
              });
              if (result.button.accept) {
                let output = dialog.getValue();
                Configuration.SECRET_KEY = output.secret_key
                Configuration.LANGUAGE = output.language
                Configuration.PROMPT = output.prompt
              }
          },
          tooltip: 'My Button'
      });
  
      notebookPanel.toolbar.insertItem(10, 'myButton', myButton);
  });
    notebooks.widgetAdded.connect((sender, notebookPanel: NotebookPanel) => {
      let notebook: Notebook = notebookPanel.content;
      if (notebook.model === null) {
        return;
      }
      // Check existing cells for errors
      notebook.widgets.forEach(cell => {
        if (cell.model.type === 'code') {
          let codeCell = cell as CodeCell;
          let codeCellModel = cell.model as ICodeCellModel;
          checkForErrors(codeCellModel, codeCell, rendermime);
        }
      });

      notebook.model.cells.changed.connect(() => {
        notebook.widgets.forEach(cell => {
          if (cell.model.type === 'code') {
            let codeCell = cell as CodeCell;
            let codeCellModel = cell.model as ICodeCellModel;
            checkForErrors(codeCellModel, codeCell, rendermime);  // Check for errors when a cell is added or removed

            codeCell.outputArea.model.changed.connect(() => {
              checkForErrors(codeCellModel, codeCell, rendermime);  // Check for errors when a cell's output changes
            });
          }
        })
      });
    });
  }
};

async function getErrorAnalysis(prompt: string, SECRET_KEY: string): Promise<string> {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [
          {role: "user", content: prompt},
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SECRET_KEY}`,
        },
      }
    )
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(error);
    throw error;  // return an empty string or handle the error as you see fit
  }
}

function checkForErrors(codeCellModel: ICodeCellModel, cell: CodeCell, rendermime: IRenderMimeRegistry) {
  if (codeCellModel.outputs.length > 0 && codeCellModel.outputs.get(0)['type'] === 'error') {
    let errorMessage = codeCellModel.outputs.get(0).data['application/vnd.jupyter.stderr']
    let errorButton = document.createElement('button');
    errorButton.innerText = 'Analyze Error';
    errorButton.className = 'error-button';

    errorButton.onclick = async () => {
      if (!Configuration.SECRET_KEY) {
        let dialog = new InputDialog(Configuration.SECRET_KEY, Configuration.LANGUAGE, Configuration.PROMPT);
        let result = await showDialog({
          title: 'Config Error Button',
          body: dialog,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'OK' })]
        });
        if (result.button.accept) {
          let output = dialog.getValue();
          Configuration.SECRET_KEY = output.secret_key
          Configuration.LANGUAGE = output.language
          Configuration.PROMPT = output.prompt
        }
      } 

      // Disable the button while loading
      errorButton.disabled = true;

      let model = new OutputAreaModel();
      let outputArea = new OutputArea({ model: model, rendermime: rendermime});
      model.add({
        output_type: 'stream',
        name: 'stdout',
        text: "Loading..."
      });    
      getErrorAnalysis(
        Configuration.PROMPT + errorMessage?.toString(),
        Configuration.SECRET_KEY
        )
        .then(result => {
          let outputText = result;
          model.clear();
          model.add({
            output_type: 'stream',
            name: 'stdout',
            text: outputText
          });
          outputArea.update();
        })
        .catch(error => {
          console.error(error);
          model.add({
            output_type: 'stream',
            name: 'stdout',
            text: error.message
          });
          outputArea.update();
        })
        .finally(() => {
          // Re-enable the button when the loading is finished
          errorButton.disabled = false;
        });

      cell.node.appendChild(outputArea.node);

    };
    cell.node.appendChild(errorButton);
  }
}
export default extension;